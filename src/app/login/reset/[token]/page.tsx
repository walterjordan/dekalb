import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { consumePasswordResetToken } from '@/lib/auth';
import { hashPassword, passwordProblem } from '@/lib/password';
import { auditNow } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function setPassword(formData: FormData) {
  'use server';
  const tenant = await requireTenant();
  const token = String(formData.get('token') || '');
  const pw = String(formData.get('password') || '');
  const pw2 = String(formData.get('password2') || '');
  const staff = await consumePasswordResetToken(token);
  if (!staff) redirect('/login/reset?sent=0');
  if (pw !== pw2) redirect(`/login/reset/${token}?err=match`);
  const problem = passwordProblem(pw);
  if (problem) redirect(`/login/reset/${token}?err=weak`);
  await prisma.staffUser.update({
    where: { id: staff!.id },
    data: { passwordHash: hashPassword(pw), emailVerifiedAt: staff!.emailVerifiedAt || new Date() },
  });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: staff!.id, actorName: staff!.name,
    action: 'PASSWORD_SET', entity: 'StaffUser', entityId: staff!.id,
    detail: `${staff!.name} set a new password via emailed link.`,
  });
  redirect('/login?reset=done');
}

export default async function SetPasswordPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { err?: string };
}) {
  await requireTenant();
  const staff = await consumePasswordResetToken(params.token);
  if (!staff) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="font-serif text-2xl font-semibold">This link is expired or not valid.</h1>
          <p className="mt-2 text-neutral-500">
            <a href="/login/reset" className="text-maroon underline">Request a fresh one.</a>
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-1 text-center font-serif text-2xl font-semibold">Choose a password</h1>
      <p className="mb-6 text-center text-sm text-neutral-500">for {staff.name}</p>
      <form action={setPassword} className="rounded-xl border border-inkline bg-white p-6 shadow-sm">
        <input type="hidden" name="token" value={params.token} />
        {searchParams.err === 'match' ? (
          <p className="mb-4 rounded-md bg-crit-bg px-4 py-3 text-sm text-crit">Those two entries did not match.</p>
        ) : null}
        {searchParams.err === 'weak' ? (
          <p className="mb-4 rounded-md bg-crit-bg px-4 py-3 text-sm text-crit">Use at least 8 characters.</p>
        ) : null}
        <label className="mb-1 block text-sm font-medium" htmlFor="password">New password</label>
        <input
          id="password" name="password" type="password" required minLength={8} autoComplete="new-password"
          className="mb-3 w-full rounded-md border border-inkline px-3 py-2.5 text-base outline-none focus:border-maroon"
        />
        <label className="mb-1 block text-sm font-medium" htmlFor="password2">Type it again</label>
        <input
          id="password2" name="password2" type="password" required minLength={8} autoComplete="new-password"
          className="mb-4 w-full rounded-md border border-inkline px-3 py-2.5 text-base outline-none focus:border-maroon"
        />
        <button className="w-full rounded-md bg-maroon px-4 py-2.5 font-semibold text-white hover:bg-maroon-light">
          Save password
        </button>
      </form>
    </main>
  );
}
