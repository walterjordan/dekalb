import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { mintLoginLink } from '@/lib/auth';
import { enqueueSms, drainSoon } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

async function requestLink(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email) return;
  const staff = await prisma.staffUser.findFirst({
    where: { tenantId: tenant.id, email: { equals: email, mode: 'insensitive' }, active: true },
  });
  // Always answer neutrally — the form never confirms whether an email exists.
  if (staff?.phone) {
    const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
    const link = await mintLoginLink(staff, base);
    await prisma.$transaction(async (tx) => {
      await enqueueSms(tx, {
        tenantId: tenant.id,
        toPhone: staff.phone!,
        body: `${tenant.name}: your sign-in link (expires in 30 minutes): ${link}`,
        kind: 'GUARDIAN_ALERT',
        idempotencyKey: `login:${staff.id}:${Math.floor(Date.now() / 60_000)}`,
      });
    });
    drainSoon();
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { sent?: string };
}) {
  const tenant = await requireTenant().catch(() => null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-maroon font-serif text-sm font-semibold text-white">
          {tenant ? tenant.name.split(' ').map((w) => w[0]).slice(0, 3).join('') : 'JAB'}
        </div>
        <h1 className="font-serif text-2xl font-semibold">{tenant?.name || 'JAB Dismissal'}</h1>
        <p className="mt-1 text-sm text-neutral-500">Staff sign-in</p>
      </div>
      <form
        action={async (fd) => {
          'use server';
          await requestLink(fd);
          const { redirect } = await import('next/navigation');
          redirect('/login?sent=1');
        }}
        className="rounded-xl border border-inkline bg-white p-6 shadow-sm"
      >
        {searchParams.sent ? (
          <p className="mb-4 rounded-md bg-good-bg px-4 py-3 text-sm text-good">
            If that email is on file, a sign-in link was just texted to the phone number we have
            for it. The link is good for 30 minutes.
          </p>
        ) : null}
        <label className="mb-1 block text-sm font-medium" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mb-4 w-full rounded-md border border-inkline px-3 py-2.5 text-base outline-none focus:border-maroon"
          placeholder="you@school.org"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-maroon px-4 py-2.5 font-semibold text-white hover:bg-maroon-light"
        >
          Text me a sign-in link
        </button>
      </form>
    </main>
  );
}
