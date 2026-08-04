import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

// Health self-report in the same shape jab-ops getRemoteServices() consumes
// from elite: { service, overall, connections: [{ id, label, category, critical, status, detail }] }.
// jab-ops env: DISMISSAL_HEALTH_URL + DISMISSAL_HEALTH_TOKEN (this CRON_SECRET).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  type Conn = { id: string; label: string; category: string; critical: boolean; status: 'ok' | 'degraded' | 'down'; detail: string };
  const connections: Conn[] = [];

  // 1. Database
  let tenantOk = false;
  try {
    const tenant = await getTenant();
    tenantOk = !!tenant;
    connections.push({
      id: 'database', label: 'Postgres (dismissal)', category: 'data', critical: true,
      status: tenantOk ? 'ok' : 'degraded',
      detail: tenantOk ? 'connected, tenant present' : 'connected, but no tenant row',
    });
  } catch (err) {
    connections.push({
      id: 'database', label: 'Postgres (dismissal)', category: 'data', critical: true,
      status: 'down', detail: err instanceof Error ? err.message.slice(0, 120) : 'unreachable',
    });
  }

  if (tenantOk) {
    const tenant = (await getTenant())!;

    // 2. Kiosk devices - quiet device during program hours is a real outage.
    const devices = await prisma.device.findMany({ where: { tenantId: tenant.id, status: 'active', kind: 'KIOSK' } });
    const staleMs = 15 * 60_000;
    const quiet = devices.filter((d) => !d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > staleMs);
    connections.push({
      id: 'kiosk-devices', label: 'Kiosk devices', category: 'edge', critical: false,
      status: devices.length === 0 ? 'degraded' : quiet.length === devices.length ? 'degraded' : 'ok',
      detail: devices.length === 0
        ? 'no kiosks provisioned yet'
        : `${devices.length - quiet.length}/${devices.length} seen in the last 15 min`,
    });

    // 3. SMS canary - the TextLink silent-failure detector.
    const canary = await prisma.messageOutbox.findFirst({
      where: { tenantId: tenant.id, kind: 'CANARY' },
      orderBy: { createdAt: 'desc' },
    });
    const canaryAge = canary ? Date.now() - canary.createdAt.getTime() : Infinity;
    connections.push({
      id: 'sms-canary', label: 'TextLink SMS canary', category: 'messaging', critical: true,
      status: !canary
        ? 'degraded'
        : canary.status === 'FAILED'
          ? 'down'
          : canaryAge > 36 * 3600_000
            ? 'degraded'
            : 'ok',
      detail: !canary
        ? 'no canary has run yet'
        : `last canary ${canary.status.toLowerCase()} ${Math.round(canaryAge / 3600_000)}h ago`,
    });

    // 4. Outbox backlog - queued safety messages that are not moving.
    const stuck = await prisma.messageOutbox.count({
      where: { tenantId: tenant.id, status: 'QUEUED', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    });
    const failed = await prisma.messageOutbox.count({ where: { tenantId: tenant.id, status: 'FAILED' } });
    connections.push({
      id: 'outbox', label: 'Message outbox', category: 'messaging', critical: true,
      status: stuck > 0 ? 'down' : failed > 0 ? 'degraded' : 'ok',
      detail: stuck > 0 ? `${stuck} messages stuck in queue >10 min` : failed > 0 ? `${failed} permanently failed` : 'draining normally',
    });
  }

  const overall: 'ok' | 'degraded' | 'down' = connections.some((c) => c.critical && c.status === 'down')
    ? 'down'
    : connections.some((c) => c.status !== 'ok')
      ? 'degraded'
      : 'ok';

  return NextResponse.json(
    { service: 'jab-dismissal', overall, generatedAt: new Date().toISOString(), connections },
    { status: overall === 'down' ? 503 : 200 },
  );
}
