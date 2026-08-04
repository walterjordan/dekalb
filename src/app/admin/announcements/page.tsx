import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { auditNow } from '@/lib/audit';
import { enqueueSms, drainSoon } from '@/lib/outbox';
import { GRADES } from '@/lib/rollcall';
import { revalidatePath } from 'next/cache';
import { timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function sendAnnouncement(formData: FormData) {
  'use server';
  const session = await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const smsBody = String(formData.get('smsBody') || '').trim();
  const audienceKind = String(formData.get('audienceKind') || 'ALL');
  const audienceGrade = String(formData.get('audienceGrade') || '');
  if (!title || !body) return;

  const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');

  // Resolve audience → guardians (notify=true, has phone), deduped per household.
  const households = await prisma.household.findMany({
    where: {
      tenantId: tenant.id,
      ...(audienceKind === 'BALANCE_DUE' ? { balanceCents: { gt: 0 } } : {}),
      ...(audienceKind === 'GRADE'
        ? { students: { some: { active: true, grade: audienceGrade } } }
        : { students: { some: { active: true } } }),
    },
    include: { guardians: { where: { notify: true, phone: { not: null } } } },
  });
  const guardians = households.flatMap((h) => {
    const primary = h.guardians.find((g) => g.isPrimary) || h.guardians[0];
    return primary ? [primary] : [];
  });

  const ann = await prisma.announcement.create({
    data: {
      tenantId: tenant.id,
      title,
      body,
      smsBody: smsBody || null,
      audienceKind,
      audienceGrade: audienceKind === 'GRADE' ? audienceGrade : null,
      channel: 'SMS',
      status: 'SENDING',
      createdById: session.staffId,
      createdByName: session.name,
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const g of guardians) {
      const outboxId = await enqueueSms(tx, {
        tenantId: tenant.id,
        toPhone: g.phone!,
        body: `${tenant.name}: ${smsBody || title} Full details: ${base}/a/${ann.id}`,
        kind: 'ANNOUNCEMENT',
        idempotencyKey: `ann:${ann.id}:${g.id}`,
        refType: 'Announcement',
        refId: ann.id,
      });
      await tx.announcementRecipient.upsert({
        where: { announcementId_guardianId_channel: { announcementId: ann.id, guardianId: g.id, channel: 'SMS' } },
        update: {},
        create: { announcementId: ann.id, guardianId: g.id, channel: 'SMS', outboxId },
      });
    }
    await tx.announcement.update({ where: { id: ann.id }, data: { status: 'SENT', sentAt: new Date() } });
  });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'ANNOUNCEMENT_SENT', entity: 'Announcement', entityId: ann.id,
    detail: `"${title}" to ${guardians.length} families (${audienceKind === 'GRADE' ? `grade ${audienceGrade}` : audienceKind.toLowerCase().replace('_', ' ')}).`,
  });
  drainSoon();
  revalidatePath('/admin/announcements');
}

export default async function AnnouncementsPage() {
  await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const past = await prisma.announcement.findMany({
    where: { tenantId: tenant.id },
    include: { recipients: true },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  return (
    <main className="max-w-3xl">
      <h1 className="font-serif text-xl font-semibold">Announcements</h1>
      <p className="mt-1 text-sm text-neutral-500">
        The text carries a short summary plus a link to the full announcement - never the whole
        thing. One text per family, to the primary contact. Email channel comes in a later phase.
      </p>

      <form action={sendAnnouncement} className="mt-4 grid gap-3 rounded-xl border border-inkline bg-white p-4 shadow-sm">
        <input name="title" required placeholder="Title (e.g. Spring recital call times)" className="rounded-md border border-inkline px-3 py-2 text-sm font-semibold" />
        <textarea name="body" required rows={4} placeholder="Full announcement - this is what the link opens." className="rounded-md border border-inkline px-3 py-2 text-sm" />
        <input name="smsBody" maxLength={120} placeholder="Short text version (optional - defaults to the title)" className="rounded-md border border-inkline px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-center gap-3">
          <select name="audienceKind" className="rounded-md border border-inkline px-3 py-2 text-sm">
            <option value="ALL">All families</option>
            <option value="GRADE">One grade</option>
            <option value="BALANCE_DUE">Families with a balance due</option>
          </select>
          <select name="audienceGrade" className="rounded-md border border-inkline px-3 py-2 text-sm">
            {GRADES.map((g) => <option key={g} value={g}>{g === 'K' ? 'K' : `Grade ${g}`}</option>)}
          </select>
          <button className="ml-auto rounded-md bg-maroon px-5 py-2 text-sm font-semibold text-white">Send now</button>
        </div>
      </form>

      <section className="mt-5">
        {past.map((a) => {
          const delivered = a.recipients.length;
          return (
            <div key={a.id} className="mb-3 rounded-xl border border-inkline bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{a.title}</span>
                <span className="font-mono text-xs text-neutral-400">
                  {a.sentAt ? `${a.sentAt.toISOString().slice(0, 10)} ${timeLabel(a.sentAt, tenant.timezone)}` : a.status}
                </span>
                <span className="ml-auto font-mono text-xs text-neutral-400">
                  {delivered} families · {a.audienceKind === 'GRADE' ? `grade ${a.audienceGrade}` : a.audienceKind.toLowerCase().replace('_', ' ')}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{a.body}</p>
            </div>
          );
        })}
        {past.length === 0 && <p className="rounded-xl border border-dashed border-inkline px-4 py-8 text-center text-sm text-neutral-400">Nothing sent yet.</p>}
      </section>
    </main>
  );
}
