import { NextRequest, NextResponse } from 'next/server';
import { deviceByToken } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { createPickupRequest, PickupError } from '@/lib/pickup';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  if (!device) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });
  const tenant = await requireTenant();
  const body = (await req.json().catch(() => ({}))) as {
    householdId?: string;
    studentIds?: string[];
    requesterName?: string;
    requesterGuardianId?: string;
    dismissalMethod?: string;
    method?: string;
  };
  try {
    const result = await createPickupRequest({
      tenant,
      householdId: String(body.householdId || ''),
      studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String) : [],
      requesterName: String(body.requesterName || ''),
      requesterGuardianId: body.requesterGuardianId ? String(body.requesterGuardianId) : null,
      method: (['QR', 'PIN', 'SEARCH'].includes(String(body.method)) ? body.method : 'PIN') as 'QR' | 'PIN' | 'SEARCH',
      dismissalMethod: (['CARLINE', 'WALKUP', 'BUS'].includes(String(body.dismissalMethod))
        ? body.dismissalMethod
        : 'CARLINE') as 'CARLINE' | 'WALKUP' | 'BUS',
      deviceId: device.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PickupError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('kiosk request failed', err);
    return NextResponse.json({ error: 'Something went wrong. Please see the front desk.' }, { status: 500 });
  }
}
