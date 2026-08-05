import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireTenant } from '@/lib/tenant';
import KioskReturn from '@/components/KioskReturn';
import { prisma } from '@/lib/prisma';
import { mintLoginLink, createSession, createLoginTicket } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { enqueueSms, drainSoon } from '@/lib/outbox';
import GoogleButton from './GoogleButton';
import WaitForApproval from './WaitForApproval';

export const dynamic = 'force-dynamic';

function destFor(role: string): string {
  return role === 'TEACHER' ? '/t' : role === 'STAFF' ? '/s' : '/admin';
}

async function passwordLogin(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const staff = await prisma.staffUser.findFirst({
    where: { tenantId: tenant.id, email: { equals: email, mode: 'insensitive' }, active: true },
  });
  if (!staff?.passwordHash || !verifyPassword(password, staff.passwordHash)) {
    redirect('/login?bad=1');
  }
  await createSession(staff);
  redirect(destFor(staff.role));
}

async function requestLink(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (email) {
    const staff = await prisma.staffUser.findFirst({
      where: { tenantId: tenant.id, email: { equals: email, mode: 'insensitive' }, active: true },
    });
    // A ticket is created either way, so the form's answer stays neutral about
    // whether the email exists. THIS device polls the ticket; tapping the
    // texted link on the phone approves it, and this device continues.
    const ticketId = await createLoginTicket(tenant.id, staff?.id || null);
    if (staff?.phone) {
      const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
      const link = await mintLoginLink(staff, base, ticketId);
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
  redirect('/login?sent=1');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { sent?: string; expired?: string; bad?: string; google?: string; reset?: string };
}) {
  const tenant = await requireTenant().catch(() => null);
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  // Set only when this sign-in started from the door kiosk. Signed out there
  // is nothing to lose, so the return is silent and needs no prompt: 30s of
  // real inactivity, reset by any tap or keystroke, so thinking time and a
  // parent interrupting mid-password do not bounce anyone.
  const kioskReturn = cookies().get('kiosk_return')?.value || null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      {kioskReturn && <KioskReturn returnTo={kioskReturn} signedIn={false} idleSeconds={30} />}
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-maroon font-serif text-sm font-semibold text-white">
          {tenant ? tenant.name.split(' ').map((w) => w[0]).slice(0, 3).join('') : 'JAB'}
        </div>
        <h1 className="font-serif text-2xl font-semibold">{tenant?.name || 'JAB Dismissal'}</h1>
        <p className="mt-1 text-sm text-neutral-500">Staff sign-in</p>
      </div>

      {searchParams.expired ? (
        <Note kind="crit" text="That sign-in link is expired or was already replaced. Use your password below, or request a fresh link." />
      ) : null}
      {searchParams.bad ? (
        <Note kind="crit" text="That email and password did not match. Try again, or use the reset link below." />
      ) : null}
      {searchParams.google === 'unknown' ? (
        <Note kind="crit" text="That Google account is not on the staff list. Ask the office to add your work email first." />
      ) : null}
      {searchParams.reset === 'done' ? (
        <Note kind="good" text="Password saved. Sign in with it below." />
      ) : null}
      {searchParams.sent ? (
        <>
          <Note kind="good" text="If that email is on file, a sign-in link was just texted to the phone number we have for it. Tap it on your phone - this screen signs itself in the moment you do." />
          <WaitForApproval />
        </>
      ) : null}

      <form action={passwordLogin} className="rounded-xl border border-inkline bg-white p-6 shadow-sm">
        <label className="mb-1 block text-sm font-medium" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mb-3 w-full rounded-md border border-inkline px-3 py-2.5 text-base outline-none focus:border-maroon"
          placeholder="you@school.org"
        />
        <label className="mb-1 block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mb-4 w-full rounded-md border border-inkline px-3 py-2.5 text-base outline-none focus:border-maroon"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-maroon px-4 py-2.5 font-semibold text-white hover:bg-maroon-light"
        >
          Sign in
        </button>
        <div className="mt-3 text-center">
          <a href="/login/reset" className="text-sm text-maroon hover:underline">
            Forgot password, or setting one up for the first time?
          </a>
        </div>
      </form>

      {googleClientId ? (
        <>
          <Divider label="or" />
          <GoogleButton clientId={googleClientId} />
        </>
      ) : null}

      <Divider label="or" />
      <form action={requestLink} className="rounded-xl border border-inkline bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm text-neutral-500">
          No password handy? We can text a one-tap sign-in link to the phone number on file.
        </p>
        <div className="flex gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="you@school.org"
            className="flex-1 rounded-md border border-inkline px-3 py-2 text-sm outline-none focus:border-maroon"
          />
          <button className="rounded-md border border-inkline px-4 py-2 text-sm font-semibold hover:border-maroon">
            Text me a link
          </button>
        </div>
      </form>
    </main>
  );
}

function Note({ kind, text }: { kind: 'good' | 'crit'; text: string }) {
  return (
    <p
      className={`mb-4 rounded-md px-4 py-3 text-sm ${
        kind === 'good' ? 'bg-good-bg text-good' : 'bg-crit-bg text-crit'
      }`}
    >
      {text}
    </p>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-neutral-400">
      <span className="h-px flex-1 bg-inkline" />
      {label}
      <span className="h-px flex-1 bg-inkline" />
    </div>
  );
}
