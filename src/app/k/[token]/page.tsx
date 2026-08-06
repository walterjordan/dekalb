import { deviceByToken } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { todayInTz } from '@/lib/dates';
import KioskClient from './KioskClient';

export const dynamic = 'force-dynamic';

export default async function KioskPage({ params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  const tenant = await requireTenant().catch(() => null);
  if (!device || !tenant || device.tenantId !== tenant.id || tenant.status !== 'active') {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Pickup is not available.</h1>
          <p className="mt-2 text-neutral-500">Please see the front desk.</p>
        </div>
      </main>
    );
  }

  // The kiosk no longer shows an attendance count. A parent standing at the
  // front door has no reason to know how many children are in the building.

  return (
    <KioskClient
      token={params.token}
      tenantName={tenant.name}
    />
  );
}
