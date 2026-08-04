import { NextRequest, NextResponse } from 'next/server';
import { deviceByToken } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { householdDetail } from '@/lib/pickup';

export const dynamic = 'force-dynamic';

// Full household detail — the step AFTER the masked confirmation.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  if (!device) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });
  const tenant = await requireTenant();
  const body = (await req.json().catch(() => ({}))) as { householdId?: string };
  if (!body.householdId) return NextResponse.json({ error: 'Missing household' }, { status: 400 });
  const detail = await householdDetail(tenant, body.householdId);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ household: detail });
}
