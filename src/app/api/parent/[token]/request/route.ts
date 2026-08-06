import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { todayInTz } from '@/lib/dates';
import { createPickupRequest, PickupError } from '@/lib/pickup';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// "I'm here" from the parent's own page: requests every eligible child in the
// household in one action, as the guardian who owns the token.
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const tenant = await requireTenant();
  const guardian = await prisma.guardian.findUnique({
    where: { parentToken: params.token },
    include: { household: true },
  });
  if (!guardian || guardian.household.tenantId !== tenant.id || !guardian.canPickup) {
    return NextResponse.json({ error: 'This pickup link is no longer active. Please see the front desk.' }, { status: 403 });
  }

  const date = todayInTz(tenant.timezone);
  const students = await prisma.student.findMany({
    where: { householdId: guardian.householdId, active: true },
    include: {
      attendance: { where: { date } },
      requestItems: { where: { status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } } },
    },
  });
  const eligible = students.filter(
    (s) => s.attendance[0]?.status === 'CHECKED_IN' && !s.requestItems.length,
  );
  if (!eligible.length) {
    return NextResponse.json({ error: 'Nobody is ready for pickup just yet. Please check with the front desk.' }, { status: 400 });
  }

  try {
    const result = await createPickupRequest({
      tenant,
      householdId: guardian.householdId,
      studentIds: eligible.map((s) => s.id),
      requesterName: `${guardian.firstName} ${guardian.lastName}`,
      requesterGuardianId: guardian.id,
      method: 'PARENT_LINK',
      dismissalMethod: 'CARLINE',
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PickupError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('parent request failed', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
