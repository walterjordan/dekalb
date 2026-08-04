import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { sha256 } from '@/lib/auth';
import { resolveApproval } from '@/lib/pickup';
import { timeLabel } from '@/lib/dates';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

// The single-use approval page a parent lands on from the SMS link. The token
// is bound to one adult + one request; a stray "yes" text can never approve.
export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { done?: string };
}) {
  const tenant = await requireTenant();
  const approval = await prisma.pickupApproval.findUnique({
    where: { tokenHash: sha256(params.token) },
    include: {
      request: { include: { students: { include: { student: true } } } },
    },
  });

  async function decide(formData: FormData) {
    'use server';
    const t = await requireTenant();
    const choice = String(formData.get('choice') || '');
    if (!['APPROVED_ONCE', 'APPROVED_ALWAYS', 'DENIED'].includes(choice)) return;
    await resolveApproval(t, params.token, choice as 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'DENIED');
    revalidatePath(`/approve/${params.token}`);
  }

  if (!approval || approval.tenantId !== tenant.id) {
    return <Shell title="This link is not valid." sub="Please call the front desk." />;
  }

  const names = approval.request.students.map((i) => i.student.firstName).join(' and ');

  if (approval.status !== 'PENDING') {
    const label =
      approval.status === 'APPROVED_ONCE'
        ? `Approved for today. ${approval.adultName} can pick up ${names} until end of day.`
        : approval.status === 'APPROVED_ALWAYS'
          ? `Approved. ${approval.adultName} is now on your approved pickup list.`
          : approval.status === 'DENIED'
            ? 'Denied. Staff will not release your child to this person.'
            : approval.status === 'EXPIRED'
              ? 'This link has expired. Please call the front desk.'
              : 'This request was handled by staff.';
    return <Shell title={label.split('.')[0] + '.'} sub={label.split('.').slice(1).join('.').trim()} used />;
  }

  if (approval.expiresAt < new Date()) {
    return <Shell title="This link has expired." sub="Please call the front desk." />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-8">
      <div className="text-center">
        <div className="font-mono text-[10px] uppercase tracking-widest text-maroon">{tenant.name}</div>
        <h1 className="mt-2 font-serif text-2xl font-semibold">Approve this pickup?</h1>
        <p className="mt-2 text-neutral-600">
          <b>{approval.adultName}</b> is at the front door asking for <b>{names}</b>, requested at{' '}
          {timeLabel(approval.request.requestedAt, tenant.timezone)}.
        </p>
      </div>
      <form action={decide} className="mt-6 grid gap-3">
        <button
          name="choice"
          value="APPROVED_ONCE"
          className="kiosk-tap rounded-xl border-2 border-inkline bg-white px-5 py-3.5 text-left font-semibold hover:border-good"
        >
          Approve today only
          <span className="block text-xs font-normal text-neutral-500">Expires at the end of today</span>
        </button>
        <button
          name="choice"
          value="APPROVED_ALWAYS"
          className="kiosk-tap rounded-xl border-2 border-inkline bg-white px-5 py-3.5 text-left font-semibold hover:border-good"
        >
          Approve permanently
          <span className="block text-xs font-normal text-neutral-500">Adds {approval.adultName} to your approved list</span>
        </button>
        <button
          name="choice"
          value="DENIED"
          className="kiosk-tap rounded-xl border-2 border-crit bg-white px-5 py-3.5 text-left font-semibold text-crit"
        >
          Deny
          <span className="block text-xs font-normal text-neutral-500">Staff will be told not to release</span>
        </button>
      </form>
      <p className="mt-5 border-t border-dashed border-inkline pt-3 text-center font-mono text-[10px] leading-relaxed text-neutral-400">
        Bound to: {approval.adultName} · {names} · this request only. Single use.
      </p>
    </main>
  );
}

function Shell({ title, sub, used }: { title: string; sub?: string; used?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        {used ? <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-good-bg text-2xl text-good">✓</div> : null}
        <h1 className="font-serif text-2xl font-semibold">{title}</h1>
        {sub ? <p className="mt-2 text-neutral-500">{sub}</p> : null}
      </div>
    </main>
  );
}
