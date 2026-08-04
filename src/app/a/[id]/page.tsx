import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

// Public announcement page - the link inside the SMS. Contains only what the
// admin wrote for families; never student data.
export default async function AnnouncementPage({ params }: { params: { id: string } }) {
  const tenant = await requireTenant().catch(() => null);
  const ann = tenant
    ? await prisma.announcement.findFirst({ where: { id: params.id, tenantId: tenant.id, status: 'SENT' } })
    : null;
  if (!tenant || !ann) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <h1 className="font-serif text-2xl font-semibold">This announcement is not available.</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <div className="font-mono text-[10px] uppercase tracking-widest text-maroon">{tenant.name}</div>
      <h1 className="mt-2 font-serif text-2xl font-semibold">{ann.title}</h1>
      <p className="mt-1 font-mono text-xs text-neutral-400">{ann.sentAt?.toISOString().slice(0, 10)}</p>
      <div className="mt-5 whitespace-pre-wrap rounded-xl border border-inkline bg-white p-5 text-[15px] leading-relaxed shadow-sm">
        {ann.body}
      </div>
    </main>
  );
}
