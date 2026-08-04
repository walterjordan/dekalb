import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GRADES } from '@/lib/rollcall';
import { saveStaff, deactivateStaff } from '../actions';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const tenant = await requireTenant();
  const [staff, groups] = await Promise.all([
    prisma.staffUser.findMany({
      where: { tenantId: tenant.id, active: true },
      include: { classGroups: { where: { active: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
    prisma.classGroup.findMany({ where: { tenantId: tenant.id, active: true } }),
  ]);
  void groups;

  return (
    <main>
      <h1 className="font-serif text-xl font-semibold">Staff &amp; teachers</h1>

      <section className="mt-4 rounded-xl border border-inkline bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Add a person</h2>
        <form action={saveStaff} className="mt-3 grid gap-3 sm:grid-cols-6">
          <input name="name" required placeholder="Full name" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
          <input name="email" type="email" placeholder="Email (for sign-in)" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
          <input name="phone" placeholder="Mobile (for alerts)" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
          <select name="role" className="rounded-md border border-inkline px-3 py-2 text-sm">
            <option value="TEACHER">Teacher</option>
            <option value="STAFF">Front desk staff</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select name="grade" className="rounded-md border border-inkline px-3 py-2 text-sm">
            <option value="">Grade (teachers)…</option>
            {GRADES.map((g) => <option key={g} value={g}>{g === 'K' ? 'K' : `Grade ${g}`}</option>)}
          </select>
          <input name="room" placeholder="Room" className="rounded-md border border-inkline px-3 py-2 text-sm" />
          <button className="rounded-md bg-maroon px-4 py-2 text-sm font-semibold text-white">Add</button>
        </form>
        <p className="mt-2 text-xs text-neutral-400">
          A teacher&apos;s mobile number is where pickup alerts go. That is the walkie-talkie replacement — set it.
        </p>
      </section>

      <section className="mt-4 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Grade / room</th>
              <th className="px-4 py-2.5">Phone</th><th className="px-4 py-2.5">Email</th><th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((p) => (
              <tr key={p.id} className="border-b border-inkline last:border-b-0">
                <td className="px-4 py-2 font-semibold">{p.name}</td>
                <td className="px-4 py-2 text-neutral-500">{p.role.toLowerCase()}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {p.classGroups.map((g) => `${g.grade}${g.room ? ` · ${g.room}` : ''}`).join(', ') || '—'}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{p.phone || <span className="text-crit">missing</span>}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{p.email || '—'}</td>
                <td className="px-4 py-2 text-right">
                  <form action={deactivateStaff} className="inline">
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs text-neutral-400 hover:text-crit">remove</button>
                  </form>
                </td>
              </tr>
            ))}
            {staff.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-400">Nobody yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
