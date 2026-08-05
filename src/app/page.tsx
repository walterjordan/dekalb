import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { getTenant, requireTenant } from '@/lib/tenant';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { enqueueSms, drainSoon } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// Re-send a parent their own pickup link, from the number they already gave
// the school. Parents type the bare domain when they lose the text, so the
// signed-out root has to be a door for them and not just a staff login.
//
// Safety: typing a number proves nothing, RECEIVING the text proves
// everything, so this only ever sends to a number already on file. The
// response is identical whether or not the number matched, otherwise this
// becomes an oracle for "does this phone belong to a family at the school".
// The outbox idempotency key throttles to one text per number per 10 minutes,
// so it cannot be used to hammer a parent's phone.
async function textMyLink(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const phone = normalizePhone(String(formData.get('phone') || '').trim());
  if (phone.length >= 12) {
    const guardian = await prisma.guardian.findFirst({
      where: { phone, canPickup: true, household: { tenantId: tenant.id } },
    });
    if (guardian) {
      const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
      await prisma.$transaction(async (tx) => {
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: phone,
          body: `${tenant.name}: here is your pickup link. Open it when you arrive and tap "I'm here". ${base}/p/${guardian.parentToken}`,
          kind: 'PARENT_LINK',
          idempotencyKey: `recover:${phone}:${Math.floor(Date.now() / 600_000)}`,
          refType: 'Guardian',
          refId: guardian.id,
        });
      });
      drainSoon();
    }
  }
  redirect('/?sent=1');
}

export default async function Home({ searchParams }: { searchParams: { sent?: string } }) {
  const session = await getSession();
  if (!session) return <SignedOut sent={searchParams.sent === '1'} />;
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

async function SignedOut({ sent }: { sent: boolean }) {
  const tenant = await getTenant();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-maroon font-serif text-sm font-bold text-white">
          {(tenant?.name || 'DAA').split(' ').map((w) => w[0]).slice(0, 3).join('')}
        </div>
        <h1 className="mt-4 font-serif text-2xl font-semibold">{tenant?.name || 'Student pickup'}</h1>
        <p className="mt-1 text-sm text-neutral-500">Student pickup</p>
      </div>

      {sent ? (
        <div className="mt-8 rounded-2xl border-2 border-good bg-good-bg p-5 text-center">
          <p className="font-semibold text-good">Check your phone.</p>
          <p className="mt-1 text-sm text-neutral-600">
            If that number is on file for a family here, we have just texted your pickup link to it.
          </p>
          <p className="mt-3 text-xs text-neutral-500">
            Nothing arrived? The number may be different from the one the school has. Ask the front
            desk and they can send it while you wait.
          </p>
        </div>
      ) : (
        <section className="mt-8 rounded-2xl border-2 border-inkline bg-white p-5 shadow-sm">
          <h2 className="font-serif text-lg font-semibold">I am picking up a child</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Enter your mobile number and we will text you your pickup link. It is the same link
            every day, so save it once.
          </p>
          <form action={textMyLink} className="mt-4 grid gap-3">
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="(404) 555-0123"
              aria-label="Your mobile number"
              className="rounded-xl border-2 border-inkline px-4 py-3 text-lg"
            />
            <button className="kiosk-tap rounded-xl bg-maroon px-5 py-3 text-lg font-semibold text-white">
              Text me my link
            </button>
          </form>
          <p className="mt-3 text-xs text-neutral-500">
            We only send to a number already on file, so the link always goes to the parent, never
            to whoever typed it.
          </p>
        </section>
      )}

      <div className="mt-6 text-center">
        <p className="text-sm text-neutral-500">At the door already? Use the iPad at the front desk.</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-maroon underline-offset-2 hover:underline">
          Staff sign in
        </Link>
      </div>
    </main>
  );
}
