import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { todayInTz, timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: { date?: string } }) {
  await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date || '') ? searchParams.date! : todayInTz(tenant.timezone);

  const records = await prisma.attendanceRecord.findMany({
    where: { tenantId: tenant.id, date },
    include: { student: true },
    orderBy: [{ student: { grade: 'asc' } }, { student: { lastName: 'asc' } }],
  });
  const requests = await prisma.pickupRequest.findMany({
    where: { tenantId: tenant.id, date },
    include: { students: true },
  });

  const released = records.filter((r) => r.status === 'RELEASED' || r.status === 'RELEASED_LATE');
  const waits = requests
    .flatMap((r) => r.students.map((i) => (i.releasedAt ? (i.releasedAt.getTime() - r.requestedAt.getTime()) / 60_000 : null)))
    .filter((v): v is number => v !== null);
  const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  const lateFees = records.reduce((sum, r) => sum + r.lateFeeCents, 0);
  const failed = await prisma.messageOutbox.count({ where: { tenantId: tenant.id, status: 'FAILED' } });

  return (
    <main>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-xl font-semibold">Daily report</h1>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded-md border border-inkline px-2 py-1.5 font-mono text-sm" />
          <button className="rounded-md border border-inkline px-3 py-1.5 text-xs font-semibold">Go</button>
        </form>
        <a
          href={`/api/reports/csv?date=${date}`}
          className="ml-auto rounded-md border border-inkline bg-white px-4 py-2 text-sm font-semibold hover:border-maroon"
        >
          Export CSV
        </a>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Attended', value: records.filter((r) => r.status !== 'ABSENT').length },
          { label: 'Absent', value: records.filter((r) => r.status === 'ABSENT').length },
          { label: 'Released', value: released.length },
          { label: 'Average wait', value: avgWait },
          { label: 'Late fees collected', value: `$${(lateFees / 100).toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-inkline bg-white p-3 text-center shadow-sm">
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-400">{s.label}</div>
          </div>
        ))}
      </div>
      {failed > 0 && (
        <p className="mt-3 rounded-md bg-crit-bg px-4 py-2.5 text-sm font-semibold text-crit">
          {failed} text message{failed === 1 ? '' : 's'} could not be delivered. Those guardians may not have heard from us. Check the activity record.
        </p>
      )}

      <section className="mt-5 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">Student</th><th className="px-4 py-2.5">Grade</th><th className="px-4 py-2.5">In</th>
              <th className="px-4 py-2.5">Out</th><th className="px-4 py-2.5">Released to</th><th className="px-4 py-2.5">By</th>
              <th className="px-4 py-2.5">Late</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className={`border-b border-inkline last:border-b-0 ${r.status === 'ABSENT' ? 'text-neutral-400' : ''}`}>
                <td className="px-4 py-2 font-semibold">{r.student.firstName} {r.student.lastName}{r.reversed ? ' (corrected)' : ''}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.student.grade}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.status === 'ABSENT' ? 'absent' : timeLabel(r.checkInAt, tenant.timezone)}</td>
                <td className="px-4 py-2 font-mono text-xs">{timeLabel(r.checkOutAt, tenant.timezone) || '-'}</td>
                <td className="px-4 py-2">{r.releasedToName || '-'}</td>
                <td className="px-4 py-2 text-neutral-500">{r.releasedByName || '-'}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {r.lateMinutes > 0 ? <span className="font-bold text-warn">{r.lateMinutes}m · ${(r.lateFeeCents / 100).toFixed(2)}</span> : '-'}
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">No attendance for {date}.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
