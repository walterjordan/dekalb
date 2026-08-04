import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { todayInTz } from '@/lib/dates';
import { qrDataUrl } from '@/lib/qr';
import ParentClient from './ParentClient';

export const dynamic = 'force-dynamic';

// The parent's page. No login - the opaque token in the URL is the credential,
// scoped to one guardian. It shows the family QR (which the kiosk scans),
// today's status per child, and the "I'm here" carline button.
export default async function ParentPage({ params }: { params: { token: string } }) {
  const tenant = await requireTenant().catch(() => null);
  const guardian = tenant
    ? await prisma.guardian.findUnique({
        where: { parentToken: params.token },
        include: { household: true },
      })
    : null;

  if (!tenant || !guardian || guardian.household.tenantId !== tenant.id) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="font-serif text-2xl font-semibold">This link is not active.</h1>
          <p className="mt-2 text-neutral-500">Please call the front desk for a new one.</p>
        </div>
      </main>
    );
  }

  const date = todayInTz(tenant.timezone);
  const students = await prisma.student.findMany({
    where: { householdId: guardian.householdId, active: true },
    include: {
      attendance: { where: { date } },
      requestItems: {
        where: { status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } },
        take: 1,
      },
    },
    orderBy: { firstName: 'asc' },
  });

  const authorized = await prisma.authorizedAdult.findMany({
    where: {
      householdId: guardian.householdId,
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  const guardians = await prisma.guardian.findMany({
    where: { householdId: guardian.householdId, canPickup: true },
  });

  const qr = await qrDataUrl(`daa:${guardian.parentToken}`, { dark: '#7B1E2B' });

  return (
    <ParentClient
      token={params.token}
      tenantName={tenant.name}
      guardianName={`${guardian.firstName} ${guardian.lastName}`}
      qr={qr}
      students={students.map((s) => {
        const a = s.attendance[0];
        const open = s.requestItems[0];
        return {
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          grade: s.grade,
          status: open
            ? open.status === 'READY'
              ? 'READY - at the door'
              : open.status === 'NEEDS_APPROVAL'
                ? 'Waiting on approval'
                : 'Pickup in progress'
            : !a
              ? 'Not checked in yet'
              : a.status === 'ABSENT'
                ? 'Absent today'
                : a.status === 'CHECKED_IN'
                  ? 'Present'
                  : 'Picked up',
          eligible: !!a && a.status === 'CHECKED_IN' && !open,
        };
      })}
      approved={[...guardians.map((g) => `${g.firstName} ${g.lastName[0]}.`), ...authorized.map((a) => a.name)]}
    />
  );
}
