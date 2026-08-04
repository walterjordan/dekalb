import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  const tenant = await getTenant();

  const tiles = [
    { href: '/roll', label: 'Roll call', sub: 'Check students in by grade', roles: ['ADMIN', 'SUPERVISOR', 'TEACHER', 'STAFF'] },
    { href: '/s', label: 'Release board', sub: 'Live pickup queue at the door', roles: ['ADMIN', 'SUPERVISOR', 'STAFF'] },
    { href: '/t', label: 'My room', sub: 'Pickup alerts for your grade', roles: ['TEACHER', 'ADMIN', 'SUPERVISOR'] },
    { href: '/admin', label: 'Dashboard', sub: 'Students, families, staff, reports', roles: ['ADMIN', 'SUPERVISOR'] },
  ].filter((t) => t.roles.includes(session.role));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold">{tenant?.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Signed in as {session.name} · {session.role.toLowerCase()}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="kiosk-tap rounded-xl border border-inkline bg-white p-5 shadow-sm hover:border-maroon"
          >
            <div className="text-lg font-semibold">{t.label}</div>
            <div className="mt-1 text-sm text-neutral-500">{t.sub}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
