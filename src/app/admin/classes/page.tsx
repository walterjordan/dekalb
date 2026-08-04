import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { saveClassGroup } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ClassesPage() {
  const tenant = await requireTenant();
  const [groups, teachers] = await Promise.all([
    prisma.classGroup.findMany({
      where: { tenantId: tenant.id, active: true },
      include: { teacher: true, students: { where: { active: true }, select: { id: true } } },
      orderBy: { grade: 'asc' },
    }),
    prisma.staffUser.findMany({ where: { tenantId: tenant.id, active: true, role: 'TEACHER' }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <main>
      <h1 className="font-serif text-xl font-semibold">Classes</h1>
      <p className="mt-1 text-sm text-neutral-500">
        One group per grade, created automatically when the first student is added. Assign the teacher and room here.
      </p>
      <section className="mt-4 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">Grade</th><th className="px-4 py-2.5">Students</th><th className="px-4 py-2.5">Teacher</th>
              <th className="px-4 py-2.5">Room</th><th className="px-4 py-2.5">Times</th><th className="px-4 py-2.5">Season</th><th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-b border-inkline last:border-b-0 align-baseline">
                <td className="px-4 py-2 font-semibold">{g.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{g.students.length}</td>
                <td colSpan={5} className="px-4 py-2">
                  <form action={saveClassGroup} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <select name="teacherId" defaultValue={g.teacherId || ''} className="rounded-md border border-inkline px-2 py-1.5 text-sm">
                      <option value="">No teacher</option>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <input name="room" defaultValue={g.room || ''} placeholder="Room" className="w-24 rounded-md border border-inkline px-2 py-1.5 text-sm" />
                    <input name="startTime" defaultValue={g.startTime || ''} placeholder="15:00" className="w-20 rounded-md border border-inkline px-2 py-1.5 font-mono text-sm" />
                    <input name="endTime" defaultValue={g.endTime || ''} placeholder="18:00" className="w-20 rounded-md border border-inkline px-2 py-1.5 font-mono text-sm" />
                    <input name="season" defaultValue={g.season || ''} placeholder="Fall" className="w-24 rounded-md border border-inkline px-2 py-1.5 text-sm" />
                    <input name="year" defaultValue={g.year || ''} placeholder="2026" className="w-20 rounded-md border border-inkline px-2 py-1.5 font-mono text-sm" />
                    <button className="rounded-md border border-inkline px-3 py-1.5 text-xs font-semibold">Save</button>
                  </form>
                </td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">No classes yet - they appear when students are added.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
