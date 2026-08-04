import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GRADES } from '@/lib/rollcall';
import { saveStudent, deactivateStudent } from '../actions';

export const dynamic = 'force-dynamic';

export default async function StudentsPage({ searchParams }: { searchParams: { new?: string; grade?: string } }) {
  const tenant = await requireTenant();
  const gradeFilter = searchParams.grade && GRADES.includes(searchParams.grade as (typeof GRADES)[number]) ? searchParams.grade : undefined;

  const [students, households] = await Promise.all([
    prisma.student.findMany({
      where: { tenantId: tenant.id, active: true, ...(gradeFilter ? { grade: gradeFilter } : {}) },
      include: { household: { include: { guardians: { where: { isPrimary: true }, take: 1 } } }, classGroup: true },
      orderBy: [{ grade: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.household.findMany({ where: { tenantId: tenant.id }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <main>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="font-serif text-xl font-semibold">Students</h1>
        <span className="font-mono text-xs text-neutral-400">{students.length} shown</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <a href="/admin/students" className={`rounded px-2 py-1 font-mono text-xs ${!gradeFilter ? 'bg-maroon text-white' : 'text-neutral-500'}`}>All</a>
          {GRADES.map((g) => (
            <a key={g} href={`/admin/students?grade=${g}`} className={`rounded px-2 py-1 font-mono text-xs ${gradeFilter === g ? 'bg-maroon text-white' : 'text-neutral-500'}`}>{g}</a>
          ))}
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-inkline bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Add a student</h2>
        {households.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            Create the <a href="/admin/families?new=1" className="text-maroon underline">family</a> first - every student belongs to one.
          </p>
        ) : (
          <form action={saveStudent} className="mt-3 grid gap-3 sm:grid-cols-6">
            <input name="firstName" required placeholder="First name" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
            <input name="lastName" required placeholder="Last name" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
            <select name="grade" className="rounded-md border border-inkline px-3 py-2 text-sm">
              {GRADES.map((g) => <option key={g} value={g}>{g === 'K' ? 'K' : `Grade ${g}`}</option>)}
            </select>
            <select name="dismissalDefault" className="rounded-md border border-inkline px-3 py-2 text-sm">
              <option value="CARLINE">Carline</option><option value="WALKUP">Walk-up</option><option value="BUS">Bus</option>
            </select>
            <select name="householdId" required className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-3">
              <option value="">Family…</option>
              {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input name="medicalNote" placeholder="Medical/allergy note (staff only)" className="rounded-md border border-inkline px-3 py-2 text-sm sm:col-span-2" />
            <button className="rounded-md bg-maroon px-4 py-2 text-sm font-semibold text-white">Add</button>
          </form>
        )}
      </section>

      <section className="mt-4 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">Student</th><th className="px-4 py-2.5">Grade</th><th className="px-4 py-2.5">Family</th>
              <th className="px-4 py-2.5">Primary contact</th><th className="px-4 py-2.5">Room</th><th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {students.map((st) => (
              <tr key={st.id} className="border-b border-inkline last:border-b-0">
                <td className="px-4 py-2 font-semibold">
                  {st.firstName} {st.lastName}
                  {st.medicalNote ? <span className="ml-2 rounded bg-warn-bg px-1.5 py-0.5 font-mono text-[10px] text-warn">MED</span> : null}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{st.grade}</td>
                <td className="px-4 py-2">{st.household.name}</td>
                <td className="px-4 py-2 text-neutral-500">
                  {st.household.guardians[0] ? `${st.household.guardians[0].firstName} ${st.household.guardians[0].lastName}` : '-'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-neutral-500">{st.classGroup?.room || '-'}</td>
                <td className="px-4 py-2 text-right">
                  <form action={deactivateStudent} className="inline">
                    <input type="hidden" name="id" value={st.id} />
                    <button className="text-xs text-neutral-400 hover:text-crit">remove</button>
                  </form>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-400">No students yet. Add one above or use Import.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
