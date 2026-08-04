import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { timeLabel } from '@/lib/dates';
import { createDevice, revokeDevice } from '../actions';

export const dynamic = 'force-dynamic';

export default async function DevicesPage({ searchParams }: { searchParams: { minted?: string } }) {
  await requireSession(['ADMIN']);
  const tenant = await requireTenant();
  const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
  const devices = await prisma.device.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });

  return (
    <main className="max-w-3xl">
      <h1 className="font-serif text-xl font-semibold">Kiosk devices</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Each iPad gets its own link. The device heartbeat feeds uptime monitoring; revoke a device
        and its link stops working immediately.
      </p>

      {searchParams.minted ? (
        <div className="mt-4 rounded-xl border-2 border-good bg-good-bg p-4">
          <p className="text-sm font-semibold text-good">Kiosk created. Open this link on the iPad, then add it to the home screen:</p>
          <p className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-xs">{base}/k/{searchParams.minted}</p>
          <p className="mt-2 text-xs text-neutral-500">This link is shown once. If you lose it, revoke the device and mint a new one.</p>
        </div>
      ) : null}

      <form action={createDevice} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-inkline bg-white p-4 shadow-sm">
        <input name="label" required placeholder='Label (e.g. "Front door iPad")' className="min-w-56 flex-1 rounded-md border border-inkline px-3 py-2 text-sm" />
        <input name="location" placeholder="Location" className="rounded-md border border-inkline px-3 py-2 text-sm" />
        <button className="rounded-md bg-maroon px-4 py-2 text-sm font-semibold text-white">Mint kiosk link</button>
      </form>

      <section className="mt-4 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">Device</th><th className="px-4 py-2.5">Location</th>
              <th className="px-4 py-2.5">Last seen</th><th className="px-4 py-2.5">Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const fresh = d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 10 * 60_000;
              return (
                <tr key={d.id} className="border-b border-inkline last:border-b-0">
                  <td className="px-4 py-2 font-semibold">{d.label}</td>
                  <td className="px-4 py-2 text-neutral-500">{d.location || '-'}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {d.lastSeenAt ? timeLabel(d.lastSeenAt, tenant.timezone) : 'never'}
                  </td>
                  <td className="px-4 py-2">
                    {d.status === 'revoked' ? (
                      <span className="rounded bg-crit-bg px-2 py-0.5 font-mono text-[10px] font-bold text-crit">REVOKED</span>
                    ) : fresh ? (
                      <span className="rounded bg-good-bg px-2 py-0.5 font-mono text-[10px] font-bold text-good">ONLINE</span>
                    ) : (
                      <span className="rounded bg-warn-bg px-2 py-0.5 font-mono text-[10px] font-bold text-warn">QUIET</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {d.status !== 'revoked' && (
                      <form action={revokeDevice} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <button className="text-xs text-neutral-400 hover:text-crit">revoke</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {devices.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">No kiosks yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
