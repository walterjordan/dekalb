import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { verifyChain } from '@/lib/audit';
import { auditActionLabel } from '@/lib/labels';
import { timeLabel, dateLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function LedgerPage({ searchParams }: { searchParams: { page?: string; verify?: string } }) {
  await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
  const PER = 50;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { seq: 'desc' },
      skip: (page - 1) * PER,
      take: PER,
    }),
    prisma.auditLog.count({ where: { tenantId: tenant.id } }),
  ]);

  const broken = searchParams.verify ? await verifyChain(tenant.id) : undefined;

  return (
    <main>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-serif text-xl font-semibold">Activity record</h1>
        <span className="font-mono text-xs text-neutral-400">{total} entries · corrections are added, original entries stay visible</span>
        <a href="/admin/ledger?verify=1" className="ml-auto text-xs text-maroon hover:underline">Check record for changes</a>
      </div>
      {broken !== undefined && (
        <p className={`mt-3 rounded-md px-4 py-2.5 text-sm font-semibold ${broken === null ? 'bg-good-bg text-good' : 'bg-crit-bg text-crit'}`}>
          {broken === null ? `Record check passed. All ${total} entries are unchanged.` : `Record check failed at entry ${broken}. That entry may have been changed outside JAB Dismissal. Nothing has been deleted; tell JAB.`}
        </p>
      )}
      <section className="mt-4 overflow-x-auto rounded-xl border border-inkline bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-inkline text-left font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              <th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Action</th><th className="px-4 py-2.5">Detail</th><th className="px-4 py-2.5">Who</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-inkline align-baseline last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-neutral-400">
                  {dateLabel(a.createdAt, tenant.timezone)} {timeLabel(a.createdAt, tenant.timezone)}
                </td>
                <td className={`whitespace-nowrap px-4 py-2 font-semibold ${
                  a.action === 'RELEASED' ? 'text-good' : /DENIED|HELD|REVERSED|OVERRIDE/.test(a.action) ? 'text-crit' : ''
                }`}>
                  {auditActionLabel(a.action)}
                </td>
                <td className="px-4 py-2 text-neutral-600">{a.detail}</td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-neutral-400">{a.actorName}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-neutral-400">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </section>
      <div className="mt-3 flex gap-2 text-sm">
        {page > 1 && <a href={`/admin/ledger?page=${page - 1}`} className="text-maroon">Newer</a>}
        {page * PER < total && <a href={`/admin/ledger?page=${page + 1}`} className="ml-auto text-maroon">Older</a>}
      </div>
    </main>
  );
}
