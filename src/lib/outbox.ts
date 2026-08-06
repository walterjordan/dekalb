// Transactional outbox. enqueue() runs inside the SAME transaction as the
// business event, so a pickup request and its teacher alert commit or fail
// together. drainOutbox() is called opportunistically after commits and by the
// outbox cron; it sends via TextLink directly (never through jab-ops, so a JAB
// billing condition can never suppress a safety text).
//
// TextLink is a SIM gateway that once returned success for five days while the
// device was powered off. So an HTTP 200 marks a row SENT, not DELIVERED;
// delivery receipts and the canary cron close the loop, and the staff board
// surfaces "not delivered" rather than assuming.
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const TEXTLINK_URL = 'https://textlinksms.com/api/send-sms';

export interface EnqueueSms {
  tenantId: string;
  toPhone: string;
  body: string;
  kind: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
}

export async function enqueueSms(tx: Tx, m: EnqueueSms): Promise<string | null> {
  if (!m.toPhone) return null;
  const row = await tx.messageOutbox.upsert({
    where: { idempotencyKey: m.idempotencyKey },
    update: {}, // idempotent: an existing key is left exactly as it is
    create: {
      tenantId: m.tenantId,
      channel: 'SMS',
      toPhone: m.toPhone,
      body: m.body,
      kind: m.kind,
      idempotencyKey: m.idempotencyKey,
      refType: m.refType || null,
      refId: m.refId || null,
    },
  });
  return row.id;
}

async function sendViaTextLink(phone: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.TEXTLINK_API_KEY || process.env.TEXTLINKSMS_API_KEY || '';
  if (!key) return { ok: false, error: 'TEXTLINK_API_KEY not set' };
  try {
    const res = await fetch(TEXTLINK_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phone, text }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    return { ok: true, id: data.id ? String(data.id) : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_ATTEMPTS = 4;

// Demo/seed numbers live in the 555 range precisely so a drain can never text a
// real person (see scripts/seed-demo.mjs). Until now they were still DIALLED,
// failed four times each, and landed FAILED permanently with nothing in the
// codebase to clear them, which is how the dashboard reached 57 failed texts.
//
// Skipping them makes an existing safety convention explicit. A real roster
// cannot contain a 555 number, so this can never suppress a message to an
// actual parent.
const DEMO_PHONE = /^\+1\d{3}555\d{4}$/;

// SKIPPED, deliberately not SENT. Marking a message that was never dialled as
// "sent" is the same acceptance-is-not-delivery lie that has caused three JAB
// outages. Every consumer checks for FAILED or QUEUED specifically, so a
// SKIPPED row is correctly invisible to the dashboard, the board and health.
const SKIPPED = 'SKIPPED';

/** Drain queued rows. Safe to call concurrently: rows are claimed via an atomic status flip. */
export async function drainOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const candidates = await prisma.messageOutbox.findMany({
    where: { status: 'QUEUED', channel: 'SMS' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const { id } of candidates) {
    // Claim: only proceeds if still QUEUED.
    const claimed = await prisma.messageOutbox.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'SENDING' },
    });
    if (!claimed.count) continue;
    const row = await prisma.messageOutbox.findUnique({ where: { id } });
    if (!row || !row.toPhone) continue;

    if (DEMO_PHONE.test(row.toPhone)) {
      await prisma.messageOutbox.update({
        where: { id },
        data: { status: SKIPPED, lastError: 'Demo number, not dialled.' },
      });
      continue;
    }

    const result = await sendViaTextLink(row.toPhone, row.body);
    if (result.ok) {
      sent++;
      await prisma.messageOutbox.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), providerId: result.id || null, attempts: { increment: 1 } },
      });
    } else {
      const attempts = row.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      if (terminal) failed++;
      await prisma.messageOutbox.update({
        where: { id },
        data: {
          status: terminal ? 'FAILED' : 'QUEUED',
          attempts,
          lastError: (result.error || 'unknown').slice(0, 500),
        },
      });
    }
  }
  return { sent, failed };
}

/** Fire-and-forget drain after a commit; errors never propagate to the request. */
export function drainSoon(): void {
  drainOutbox().catch(() => undefined);
}
