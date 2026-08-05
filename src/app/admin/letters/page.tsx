import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { qrDataUrl } from '@/lib/qr';

export const dynamic = 'force-dynamic';

// Printable PIN/QR letters, one per family. Print → save as PDF from the
// browser; no PDF library needed. Each letter carries the family PIN and the
// primary guardian's personal QR + parent link.
export default async function LettersPage({ searchParams }: { searchParams: { print?: string; f?: string } }) {
  await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');

  // `?f=<householdId>` prints ONE family, which is what the Print button on
  // /admin/families links to. Without it you get the whole school for the
  // first-day mail-out.
  const only = searchParams.f || null;

  const households = await prisma.household.findMany({
    where: {
      tenantId: tenant.id,
      students: { some: { active: true } },
      ...(only ? { id: only } : {}),
    },
    include: {
      guardians: { orderBy: { isPrimary: 'desc' } },
      students: { where: { active: true }, orderBy: { firstName: 'asc' } },
    },
    orderBy: { name: 'asc' },
  });

  const letters = await Promise.all(
    households.map(async (h) => {
      const g = h.guardians[0];
      return {
        id: h.id,
        family: h.name,
        pin: h.pin,
        guardian: g ? `${g.firstName} ${g.lastName}` : null,
        link: g ? `${base}/p/${g.parentToken}` : null,
        qr: g ? await qrDataUrl(`daa:${g.parentToken}`, { dark: '#7B1E2B' }) : '',
        students: h.students.map((s) => `${s.firstName} (${s.grade === 'K' ? 'K' : `Gr ${s.grade}`})`).join(', '),
      };
    }),
  );

  return (
    <main>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="font-serif text-xl font-semibold">
          {only ? 'Family letter' : 'Family PIN letters'}
        </h1>
        <span className="font-mono text-xs text-neutral-400">{letters.length} {letters.length === 1 ? 'family' : 'families'}</span>
        {only && (
          <a href="/admin/letters" className="text-xs text-maroon hover:underline">print all families instead</a>
        )}
        <span className="ml-auto text-xs text-neutral-400">Use your browser&apos;s Print → Save as PDF. One letter per page.</span>
      </div>

      <div className="mt-5 grid gap-6">
        {letters.map((l) => (
          <section
            key={l.id}
            className="rounded-xl border border-inkline bg-white p-8 shadow-sm print:break-after-page print:rounded-none print:border-0 print:shadow-none"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-maroon font-serif text-xs font-bold text-white">
                {tenant.name.split(' ').map((w) => w[0]).slice(0, 3).join('')}
              </div>
              <div>
                <h2 className="font-serif text-xl font-semibold">{tenant.name}</h2>
                <p className="text-sm text-neutral-500">Student pickup - your family&apos;s codes</p>
              </div>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm">
                  Dear {l.guardian || l.family},
                </p>
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-neutral-700">
                  We now use a digital pickup system for {l.students}. At pickup, scan the code on
                  this letter (or from your personal link below) at the front-door iPad, or type
                  your family PIN. A staff member always hands your child over in person - the code
                  only tells us you have arrived.
                </p>
                <div className="mt-5 flex items-center gap-4">
                  <div className="rounded-lg border-2 border-maroon px-5 py-3 text-center">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">Family PIN</div>
                    <div className="font-mono text-3xl font-bold tracking-[0.3em] text-maroon">{l.pin}</div>
                  </div>
                  {l.link ? (
                    <p className="max-w-56 text-xs leading-relaxed text-neutral-500">
                      Your personal page (live status, and this same code on your phone):
                      <span className="mt-1 block break-all font-mono text-[10px]">{l.link}</span>
                    </p>
                  ) : (
                    <p className="max-w-56 text-xs text-crit">
                      No guardian on file yet - add one in Families to give this household a parent link.
                    </p>
                  )}
                </div>
                <p className="mt-4 text-xs text-neutral-400">
                  Keep this letter private. If it is lost, call the front desk and we will issue a new PIN.
                </p>
              </div>
              {l.qr ? (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.qr} alt="Pickup QR code" className="h-44 w-44" />
                  <div className="mt-1 font-mono text-[10px] text-neutral-400">SCAN AT THE KIOSK</div>
                </div>
              ) : null}
            </div>
          </section>
        ))}
        {letters.length === 0 && (
          <p className="rounded-xl border border-dashed border-inkline px-4 py-10 text-center text-sm text-neutral-400">
            No families with students yet.
          </p>
        )}
      </div>
    </main>
  );
}
