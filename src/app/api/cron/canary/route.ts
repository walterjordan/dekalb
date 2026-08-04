import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { enqueueSms, drainOutbox } from '@/lib/outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily canary: sends a test SMS to CANARY_PHONE and reports whether the LAST
// canary ever got sent. TextLink once returned success for five days with the
// SIM powered off - the canary is how that failure mode gets caught in hours,
// not days. jab-ops polls /api/health/connections which folds this state in.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tenant = await getTenant();
  const to = process.env.CANARY_PHONE || '';
  if (!tenant || !to) return NextResponse.json({ skipped: true });

  const prior = await prisma.messageOutbox.findFirst({
    where: { tenantId: tenant.id, kind: 'CANARY' },
    orderBy: { createdAt: 'desc' },
  });
  const priorOk = !prior || prior.status === 'SENT' || prior.status === 'DELIVERED';

  const day = new Date().toISOString().slice(0, 10);
  await prisma.$transaction(async (tx) => {
    await enqueueSms(tx, {
      tenantId: tenant.id,
      toPhone: to,
      body: `jab-dismissal canary ${day} - if you can read this, the SMS path works.`,
      kind: 'CANARY',
      idempotencyKey: `canary:${day}`,
    });
  });
  const drained = await drainOutbox(5);
  return NextResponse.json({ priorCanaryOk: priorOk, drained });
}
