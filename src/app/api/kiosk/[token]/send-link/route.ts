import { NextRequest, NextResponse } from 'next/server';
import { deviceByToken } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { enqueueSms, drainSoon } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// "Text me my link" at the kiosk, for the parent standing at the door who
// never got the letter or lost it.
//
// The response is ALWAYS the same shape whether or not the number matched.
// Anything else turns a front-door iPad into an oracle for "does this phone
// belong to a family at this school", which is exactly the roster probe the
// device token exists to prevent.
//
// It only ever sends to a number already on file: typing a number proves
// nothing, receiving the text proves everything. The outbox idempotency key
// throttles to one text per number per 10 minutes, so nobody can stand at the
// iPad and hammer a parent's phone.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  if (!device) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });
  const tenant = await requireTenant();
  if (device.tenantId !== tenant.id) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  const phone = normalizePhone(String(body.phone || '').trim());

  if (phone.length >= 12) {
    const guardian = await prisma.guardian.findFirst({
      where: { phone, canPickup: true, household: { tenantId: tenant.id } },
    });
    if (guardian) {
      const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
      await prisma.$transaction(async (tx) => {
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: phone,
          body: `${tenant.name}: here is your pickup link. Open it when you arrive and tap "I'm here". ${base}/p/${guardian.parentToken}`,
          kind: 'PARENT_LINK',
          idempotencyKey: `recover:${phone}:${Math.floor(Date.now() / 600_000)}`,
          refType: 'Guardian',
          refId: guardian.id,
        });
      });
      drainSoon();
    }
  }

  return NextResponse.json({ ok: true });
}
