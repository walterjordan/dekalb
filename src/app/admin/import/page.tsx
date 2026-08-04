import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { auditNow } from '@/lib/audit';
import { normalizePhone } from '@/lib/phone';
import { GRADES } from '@/lib/rollcall';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface ParsedRow {
  line: number;
  firstName: string;
  lastName: string;
  grade: string;
  family: string;
  guardianFirst: string;
  guardianLast: string;
  guardianPhone: string;
  error?: string;
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip an obvious header line.
    if (i === 0 && /first/i.test(raw) && /grade/i.test(raw)) continue;
    const cols = raw.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const [firstName = '', lastName = '', gradeRaw = '', family = '', gFirst = '', gLast = '', gPhone = ''] = cols;
    const grade = gradeRaw.toUpperCase() === 'K' || gradeRaw === '0' ? 'K' : gradeRaw.replace(/^G(?:RADE)?\s*/i, '');
    let error: string | undefined;
    if (!firstName || !lastName) error = 'Missing student name';
    else if (!GRADES.includes(grade as (typeof GRADES)[number])) error = `Grade "${gradeRaw}" is not K-8`;
    rows.push({
      line: i + 1,
      firstName,
      lastName,
      grade,
      family: family || `${lastName} family`,
      guardianFirst: gFirst,
      guardianLast: gLast || (gFirst ? lastName : ''),
      guardianPhone: gPhone,
      error,
    });
  }
  return rows;
}

async function runImport(formData: FormData) {
  'use server';
  const session = await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  const text = String(formData.get('csv') || '');
  const rows = parseCsv(text).filter((r) => !r.error);
  if (!rows.length) redirect('/admin/import?err=1');

  let created = 0;
  for (const r of rows) {
    // Family: find by exact name or create with a fresh unique PIN.
    let household = await prisma.household.findFirst({ where: { tenantId: tenant.id, name: r.family } });
    if (!household) {
      let pin = String(Math.floor(1000 + Math.random() * 9000));
      for (let i = 0; i < 50; i++) {
        const clash = await prisma.household.findUnique({ where: { tenantId_pin: { tenantId: tenant.id, pin } } });
        if (!clash) break;
        pin = String(Math.floor(1000 + Math.random() * 9000));
      }
      household = await prisma.household.create({ data: { tenantId: tenant.id, name: r.family, pin } });
    }
    if (r.guardianFirst) {
      const existingG = await prisma.guardian.findFirst({
        where: { householdId: household.id, firstName: { equals: r.guardianFirst, mode: 'insensitive' }, lastName: { equals: r.guardianLast, mode: 'insensitive' } },
      });
      if (!existingG) {
        const anyPrimary = await prisma.guardian.findFirst({ where: { householdId: household.id, isPrimary: true } });
        await prisma.guardian.create({
          data: {
            householdId: household.id,
            firstName: r.guardianFirst,
            lastName: r.guardianLast,
            phone: r.guardianPhone ? normalizePhone(r.guardianPhone) : null,
            isPrimary: !anyPrimary,
          },
        });
      }
    }
    const dupe = await prisma.student.findFirst({
      where: {
        tenantId: tenant.id, householdId: household.id, active: true,
        firstName: { equals: r.firstName, mode: 'insensitive' },
        lastName: { equals: r.lastName, mode: 'insensitive' },
      },
    });
    if (!dupe) {
      let group = await prisma.classGroup.findFirst({ where: { tenantId: tenant.id, grade: r.grade, active: true } });
      if (!group) {
        group = await prisma.classGroup.create({
          data: { tenantId: tenant.id, grade: r.grade, name: r.grade === 'K' ? 'Kindergarten' : `Grade ${r.grade}` },
        });
      }
      await prisma.student.create({
        data: {
          tenantId: tenant.id, householdId: household.id,
          firstName: r.firstName, lastName: r.lastName, grade: r.grade, classGroupId: group.id,
        },
      });
      created++;
    }
  }
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'ROSTER_IMPORTED', entity: 'Tenant', entityId: tenant.id,
    detail: `Roster import: ${created} students created from ${rows.length} valid rows.`,
  });
  redirect(`/admin/import?done=${created}`);
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: { preview?: string; done?: string; err?: string };
}) {
  await requireSession(['ADMIN', 'SUPERVISOR']);
  return (
    <main className="max-w-3xl">
      <h1 className="font-serif text-xl font-semibold">Import roster from a spreadsheet</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-500">
        Paste rows from Excel or Google Sheets. Columns in order:{' '}
        <span className="font-mono text-xs">student first, student last, grade (K-8), family name, parent first, parent last, parent phone</span>.
        Family name and parent columns are optional - students with the same family name share one PIN.
      </p>

      {searchParams.done ? (
        <p className="mt-4 rounded-md bg-good-bg px-4 py-3 text-sm font-semibold text-good">
          Imported {searchParams.done} students. Check <a className="underline" href="/admin/students">Students</a> and print <a className="underline" href="/admin/letters">PIN letters</a>.
        </p>
      ) : null}
      {searchParams.err ? (
        <p className="mt-4 rounded-md bg-crit-bg px-4 py-3 text-sm text-crit">Nothing valid to import - check the column order.</p>
      ) : null}

      <form action={runImport} className="mt-5">
        <textarea
          name="csv"
          rows={10}
          required
          placeholder={'Ava,Johnson,3,Johnson family,Tamika,Johnson,404-555-0148\nMaya,Johnson,7,Johnson family\nAmir,Thomas,2,Thomas family,Denise,Thomas,404-555-0132'}
          className="w-full rounded-xl border border-inkline bg-white p-4 font-mono text-xs leading-relaxed outline-none focus:border-maroon"
        />
        <div className="mt-3 flex items-center gap-3">
          <button className="rounded-md bg-maroon px-5 py-2.5 text-sm font-semibold text-white">Validate and import</button>
          <span className="text-xs text-neutral-400">Rows with problems are skipped and reported; nothing is double-imported.</span>
        </div>
      </form>
    </main>
  );
}
