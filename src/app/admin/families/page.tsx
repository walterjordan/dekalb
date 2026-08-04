import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import {
  saveHousehold, saveGuardian, saveAuthorizedAdult, revokeAuthorizedAdult,
  saveRestriction, endRestriction,
} from '../actions';

export const dynamic = 'force-dynamic';

export default async function FamiliesPage({ searchParams }: { searchParams: { f?: string } }) {
  const session = await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const isAdmin = session.role === 'ADMIN';

  const households = await prisma.household.findMany({
    where: { tenantId: tenant.id },
    include: {
      guardians: { orderBy: { isPrimary: 'desc' } },
      students: { where: { active: true } },
      authorized: { where: { status: { in: ['ACTIVE', 'PENDING_PARENT_VERIFY'] } } },
      restrictions: { where: { active: true } },
    },
    orderBy: { name: 'asc' },
  });
  const open = searchParams.f || households[0]?.id;
  const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');

  return (
    <main>
      <div className="flex items-baseline gap-3">
        <h1 className="font-serif text-xl font-semibold">Families</h1>
        <span className="font-mono text-xs text-neutral-400">{households.length}</span>
      </div>

      <section className="mt-4 rounded-xl border border-inkline bg-white p-4 shadow-sm">
        <form action={saveHousehold} className="flex flex-wrap items-center gap-3">
          <input name="name" required placeholder="New family name (e.g. Johnson family)" className="min-w-64 flex-1 rounded-md border border-inkline px-3 py-2 text-sm" />
          <button className="rounded-md bg-maroon px-4 py-2 text-sm font-semibold text-white">Add family</button>
          <span className="text-xs text-neutral-400">A 4-digit PIN is assigned automatically.</span>
        </form>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="max-h-[70vh] overflow-y-auto rounded-xl border border-inkline bg-white shadow-sm">
          {households.map((h) => (
            <a
              key={h.id}
              href={`/admin/families?f=${h.id}`}
              className={`block border-b border-inkline px-4 py-2.5 text-sm last:border-b-0 ${h.id === open ? 'bg-sunk font-semibold' : ''}`}
            >
              {h.name}
              {h.balanceCents > 0 && <span className="ml-2 rounded bg-crit-bg px-1.5 py-0.5 font-mono text-[10px] font-bold text-crit">${(h.balanceCents / 100).toFixed(0)}</span>}
              {h.restrictions.length > 0 && isAdmin && <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">R</span>}
              <span className="block text-xs font-normal text-neutral-400">
                {h.students.map((s) => s.firstName).join(', ') || 'no students'}
              </span>
            </a>
          ))}
          {households.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-400">No families yet.</p>}
        </nav>

        {households.filter((h) => h.id === open).map((h) => (
          <div key={h.id} className="grid content-start gap-4">
            <section className="rounded-xl border border-inkline bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="font-serif text-lg font-semibold">{h.name}</h2>
                <span className="rounded bg-sunk px-2 py-0.5 font-mono text-sm">PIN {h.pin}</span>
                <span className="font-mono text-xs text-neutral-400">{h.students.length} students</span>
              </div>
              <form action={saveHousehold} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={h.id} />
                <input type="hidden" name="name" value={h.name} />
                <label className="text-xs text-neutral-500">Balance $</label>
                <input name="balance" defaultValue={(h.balanceCents / 100).toFixed(2)} className="w-24 rounded-md border border-inkline px-2 py-1.5 text-sm tabular-nums" />
                <input name="balanceNote" defaultValue={h.balanceNote || ''} placeholder="Note (e.g. April tuition)" className="min-w-40 flex-1 rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <button className="rounded-md border border-inkline px-3 py-1.5 text-xs font-semibold">Save</button>
                {h.balanceCents > 0 && <span className="rounded bg-crit-bg px-2 py-1 text-xs font-bold text-crit">⚠ DUE</span>}
              </form>
            </section>

            <section className="rounded-xl border border-inkline bg-white p-4 shadow-sm">
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">Parents / guardians</h3>
              {h.guardians.map((g) => (
                <div key={g.id} className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold">{g.firstName} {g.lastName}</span>
                  {g.isPrimary && <span className="rounded bg-sunk px-1.5 py-0.5 font-mono text-[10px]">PRIMARY</span>}
                  <span className="text-neutral-500">{g.relationship}</span>
                  <span className="font-mono text-xs text-neutral-400">{g.phone || 'no phone'}</span>
                  <a href={`${base}/p/${g.parentToken}`} className="ml-auto text-xs text-maroon hover:underline">parent link</a>
                </div>
              ))}
              <form action={saveGuardian} className="mt-3 grid gap-2 border-t border-inkline pt-3 sm:grid-cols-5">
                <input type="hidden" name="householdId" value={h.id} />
                <input name="firstName" required placeholder="First" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <input name="lastName" required placeholder="Last" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <input name="phone" placeholder="Mobile" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <input name="relationship" placeholder="Relation" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <label className="flex items-center gap-1.5 text-xs text-neutral-500"><input type="checkbox" name="isPrimary" /> primary</label>
                <button className="rounded-md border border-inkline px-3 py-1.5 text-xs font-semibold sm:col-start-5">+ Guardian</button>
              </form>
            </section>

            <section className="rounded-xl border border-inkline bg-white p-4 shadow-sm">
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">Approved pickup adults (not parents)</h3>
              {h.authorized.map((a) => (
                <div key={a.id} className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold">{a.name}</span>
                  <span className="text-neutral-500">{a.relationship || ''}</span>
                  <span className="font-mono text-xs text-neutral-400">
                    {a.status === 'PENDING_PARENT_VERIFY' ? 'awaiting parent verify' : a.expiresAt ? `until ${a.expiresAt.toISOString().slice(0, 10)}` : 'permanent'}
                  </span>
                  <form action={revokeAuthorizedAdult} className="ml-auto">
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs text-neutral-400 hover:text-crit">revoke</button>
                  </form>
                </div>
              ))}
              {h.authorized.length === 0 && <p className="mt-2 text-sm text-neutral-400">None yet.</p>}
              <form action={saveAuthorizedAdult} className="mt-3 grid gap-2 border-t border-inkline pt-3 sm:grid-cols-5">
                <input type="hidden" name="householdId" value={h.id} />
                <input name="name" required placeholder="Full name" className="rounded-md border border-inkline px-2 py-1.5 text-sm sm:col-span-2" />
                <input name="relationship" placeholder="Relation" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <input name="expiresAt" type="date" title="Leave empty for permanent" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                <button className="rounded-md border border-inkline px-3 py-1.5 text-xs font-semibold">+ Approved adult</button>
              </form>
              <p className="mt-2 text-xs text-neutral-400">Leave the date empty for permanent. Set it for a temporary authorization that expires on that day.</p>
            </section>

            {isAdmin && (
              <section className="rounded-xl border border-neutral-800 bg-white p-4 shadow-sm">
                <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-800">Restrictions (admin only)</h3>
                {h.restrictions.map((r) => (
                  <div key={r.id} className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-semibold">{r.restrictedName}</span>
                    <span className="text-neutral-500">{r.sourceNote || ''}</span>
                    <form action={endRestriction} className="ml-auto">
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-neutral-400 hover:text-crit">end</button>
                    </form>
                  </div>
                ))}
                {h.restrictions.length === 0 && <p className="mt-2 text-sm text-neutral-400">None on file.</p>}
                <form action={saveRestriction} className="mt-3 grid gap-2 border-t border-inkline pt-3 sm:grid-cols-2">
                  <input type="hidden" name="householdId" value={h.id} />
                  <input name="restrictedName" required placeholder="Restricted person's name" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                  <input name="sourceNote" placeholder="Source (e.g. custody order on file)" className="rounded-md border border-inkline px-2 py-1.5 text-sm" />
                  <input name="staffOnlyDetail" placeholder="Detail - visible to front office only" className="rounded-md border border-inkline px-2 py-1.5 text-sm sm:col-span-2" />
                  <button className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white sm:col-start-2">+ Restriction</button>
                </form>
                <p className="mt-2 text-xs text-neutral-400">
                  Floor staff see only that a restriction exists and to route to the front office. They never see these fields.
                </p>
              </section>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
