import { NextRequest, NextResponse } from 'next/server';
import { deviceByToken } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { lookupHousehold } from '@/lib/pickup';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Lookup returns MASKED matches only. A guardianToken (from the parent QR)
// resolves directly: possession of the parent's own link is the confirmation.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  if (!device) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });
  const tenant = await requireTenant();
  if (device.tenantId !== tenant.id) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { query?: string; guardianToken?: string };

  if (body.guardianToken) {
    const guardian = await prisma.guardian.findUnique({
      where: { parentToken: body.guardianToken },
      include: { household: true },
    });
    if (!guardian || guardian.household.tenantId !== tenant.id) {
      return NextResponse.json({ matches: [] });
    }
    return NextResponse.json({
      direct: {
        householdId: guardian.householdId,
        guardianName: `${guardian.firstName} ${guardian.lastName}`,
        guardianId: guardian.id,
      },
    });
  }

  const matches = await lookupHousehold(tenant, String(body.query || ''));
  return NextResponse.json({ matches });
}
