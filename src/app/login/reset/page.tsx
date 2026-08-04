import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { mintPasswordResetToken } from '@/lib/auth';
import { sendEmail, emailConfigured } from '@/lib/email';
import { enqueueSms, drainSoon } from '@/lib/outbox';

export const dynamic = 'force-dynamic';

// One flow serves both "forgot password" and "setting one up for the first
// time": prove you control the email (or the phone on file) and set a new
// password. Completing it via email also marks the email verified.
async function requestReset(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (email) {
    const staff = await prisma.staffUser.findFirst({
      where: { tenantId: tenant.id, email: { equals: email, mode: 'insensitive' }, active: true },
    });
    // Neutral answer either way.
    if (staff) {
      const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
      const token = await mintPasswordResetToken(staff);
      const link = `${base}/login/reset/${token}`;
      let delivered = false;
      if (staff.email && emailConfigured()) {
        delivered = await sendEmail({
          to: staff.email,
          subject: `${tenant.name} - set your password`,
          fromName: tenant.name,
          text: `Hi ${staff.name.split(' ')[0]},\n\nUse this link to set your ${tenant.name} password. It expires in 60 minutes:\n\n${link}\n\nIf you did not ask for this, you can ignore it.`,
        });
      }
      if (!delivered && staff.phone) {
        // Fallback: the phone on file is an already-trusted channel here (it is
        // how magic-link sign-in works), so the reset link may ride it too.
        await prisma.$transaction(async (tx) => {
          await enqueueSms(tx, {
            tenantId: tenant.id,
            toPhone: staff.phone!,
            body: `${tenant.name}: set your password here (expires in 60 min): ${link}`,
            kind: 'GUARDIAN_ALERT',
            idempotencyKey: `pwreset:${staff.id}:${Math.floor(Date.now() / 60_000)}`,
          });
        });
        drainSoon();
      }
    }
  }
  redirect('/login/reset?sent=1');
}

export default async function ResetRequestPage({ searchParams }: { searchParams: { sent?: string } }) {
  await requireTenant().catch(() => null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-1 text-center font-serif text-2xl font-semibold">Set or reset your password</h1>
      <p className="mb-6 text-center text-sm text-neutral-500">
        Works the first time too - use it to create your password.
      </p>
      <form action={requestReset} className="rounded-xl border border-inkline bg-white p-6 shadow-sm">
        {searchParams.sent ? (
          <p className="mb-4 rounded-md bg-good-bg px-4 py-3 text-sm text-good">
            If that email is on the staff list, a password link is on its way - check your email
            first, and your text messages if nothing arrives.
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
        <button className="w-full rounded-md bg-maroon px-4 py-2.5 font-semibold text-white hover:bg-maroon-light">
          Send me a password link
        </button>
        <div className="mt-3 text-center">
          <a href="/login" className="text-sm text-maroon hover:underline">
            Back to sign-in
          </a>
        </div>
      </form>
    </main>
  );
}
