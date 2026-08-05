import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import KioskReturn from '@/components/KioskReturn';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Today' },
  { href: '/admin/students', label: 'Students' },
  { href: '/admin/families', label: 'Families' },
  { href: '/admin/staff', label: 'Staff' },
  { href: '/admin/classes', label: 'Classes' },
  { href: '/admin/import', label: 'Import' },
  { href: '/admin/letters', label: 'PIN letters' },
  { href: '/admin/announcements', label: 'Announcements' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/ledger', label: 'Ledger' },
  { href: '/admin/devices', label: 'Devices' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect('/login?next=/admin');
  if (!['ADMIN', 'SUPERVISOR'].includes(session.role)) redirect('/');

  // Only set when this session began by long-pressing the kiosk header, so
  // staff on their own laptop never see any of the leash below.
  const kioskReturn = cookies().get('kiosk_return')?.value || null;

  return (
    <div className="min-h-screen">
      {kioskReturn && <KioskReturn returnTo={kioskReturn} signedIn idleSeconds={90} />}
      <header className="border-b border-inkline bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-5">
          <div className="flex items-center justify-between pt-3">
            <Link href="/admin" className="font-serif text-lg font-semibold">
              Dashboard
            </Link>
            <div className="flex items-center gap-3">
              {/* Leaving deliberately should never require waiting for a timer. */}
              {kioskReturn && (
                <a
                  href={kioskReturn}
                  className="rounded-md border border-inkline px-2.5 py-1 text-xs font-semibold text-maroon"
                >
                  Return to kiosk
                </a>
              )}
              <span className="text-xs text-neutral-400">{session.name}</span>
            </div>
          </div>
          {/* One line, side-scrolls on phone and iPad instead of wrapping into a block. */}
          <nav className="-mx-4 mt-1 flex gap-1 overflow-x-auto whitespace-nowrap px-4 pb-2 text-sm sm:-mx-5 sm:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="flex-none rounded-md px-2.5 py-1.5 text-neutral-600 hover:bg-sunk hover:text-maroon"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5">{children}</div>
    </div>
  );
}
