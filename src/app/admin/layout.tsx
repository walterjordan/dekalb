import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-inkline bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <Link href="/admin" className="font-serif text-lg font-semibold">
            Dashboard
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-neutral-600 hover:bg-sunk hover:text-maroon">
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto text-xs text-neutral-400">{session.name}</span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-6">{children}</div>
    </div>
  );
}
