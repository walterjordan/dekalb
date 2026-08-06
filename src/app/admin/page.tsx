import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { todayInTz, timeLabel } from '@/lib/dates';
import { auditActionLabel, pickupStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function AdminToday() {
  const tenant = await requireTenant();
  const date = todayInTz(tenant.timezone);

  const [present, absent, totalStudents, liveItems, heldRequests, lateToday, balancesDue, recentAudit, unmarked] =
    await Promise.all([
      prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'CHECKED_IN' } }),
      prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'ABSENT' } }),
      prisma.student.count({ where: { tenantId: tenant.id, active: true } }),
      prisma.pickupRequestStudent.findMany({
        where: { request: { tenantId: tenant.id, date }, status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } },
        include: { student: true, request: true },
        orderBy: { request: { requestedAt: 'asc' } },
        take: 12,
      }),
      prisma.pickupRequest.count({ where: { tenantId: tenant.id, date, status: 'NEEDS_APPROVAL' } }),
      prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'RELEASED_LATE' } }),
      prisma.household.count({ where: { tenantId: tenant.id, balanceCents: { gt: 0 } } }),
      prisma.auditLog.findMany({ where: { tenantId: tenant.id }, orderBy: { seq: 'desc' }, take: 10 }),
      prisma.student.count({
        where: { tenantId: tenant.id, active: true, attendance: { none: { date } } },
      }),
    ]);

  const stats = [
    { label: 'Present', value: present, href: '/roll' },
    { label: 'Attendance not marked', value: unmarked, href: '/roll', warn: unmarked > 0 && present > 0 },
    { label: 'Absent', value: absent, href: '/roll' },
    { label: 'Awaiting release', value: liveItems.length, href: '/s' },
    { label: 'Needs approval', value: heldRequests, href: '/s', warn: heldRequests > 0 },
    { label: 'Late pickups', value: lateToday, href: '/admin/reports', warn: lateToday > 0 },
    { label: 'Families with balances', value: balancesDue, href: '/admin/families', warn: balancesDue > 0 },
  ];

  return (
    <main>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-serif text-xl font-semibold">{tenant.name}</h1>
        <span className="whitespace-nowrap text-xs text-neutral-500">
          {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
          })}
          {' · '}
          {totalStudents} students enrolled
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={`rounded-xl border bg-white p-3 text-center shadow-sm ${s.warn ? 'border-warn' : 'border-inkline'}`}
          >
            <div className={`text-2xl font-bold tabular-nums ${s.warn ? 'text-warn' : ''}`}>{s.value}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-400">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-inkline bg-white shadow-sm">
          <h2 className="border-b border-inkline px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-neutral-400">
            Waiting for pickup
          </h2>
          {liveItems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">Nothing waiting.</p>
          ) : (
            liveItems.map((i) => (
              <div key={i.id} className="flex items-baseline gap-2 border-b border-inkline px-4 py-2 text-sm last:border-b-0">
                <span className="font-semibold">
                  {i.student.firstName} {i.student.lastName}
                </span>
                <span className="font-mono text-xs text-neutral-400">Gr {i.student.grade}</span>
                <span className="text-xs text-neutral-500">{i.request.requesterName}</span>
                <span
                  className={`ml-auto font-mono text-[10px] font-bold ${
                    i.status === 'NEEDS_APPROVAL' ? 'text-crit' : i.status === 'READY' ? 'text-good' : 'text-warn'
                  }`}
                >
                  {pickupStatusLabel(i.status)}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="rounded-xl border border-inkline bg-white shadow-sm">
          <h2 className="border-b border-inkline px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-neutral-400">
            Activity record
          </h2>
          {recentAudit.map((a) => (
            <div key={a.id} className="border-b border-inkline px-4 py-2 text-sm last:border-b-0">
              <span className="font-mono text-xs text-neutral-400">{timeLabel(a.createdAt, tenant.timezone)}</span>{' '}
              <span
                className={`font-semibold ${
                  a.action === 'RELEASED' ? 'text-good' : /DENIED|HELD|REVERSED/.test(a.action) ? 'text-crit' : ''
                }`}
              >
                {auditActionLabel(a.action)}
              </span>{' '}
              <span className="text-neutral-600">{a.detail}</span>
            </div>
          ))}
          <div className="px-4 py-2 text-right">
            <Link href="/admin/ledger" className="text-xs text-maroon hover:underline">
              See the full record
            </Link>
          </div>
        </section>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {[
          { href: '/admin/students?new=1', label: '+ Student' },
          { href: '/admin/families?new=1', label: '+ Family' },
          { href: '/admin/staff?new=1', label: '+ Teacher / staff' },
          { href: '/admin/import', label: 'Import roster from spreadsheet' },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="rounded-lg border border-inkline bg-white px-4 py-2 text-sm font-semibold hover:border-maroon">
            {q.label}
          </Link>
        ))}
      </div>
    </main>
  );
}
