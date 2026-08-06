/**
 * Shape the demo tenant into an ideal afternoon, for showing a principal.
 *
 *   DEFAULT_TENANT_SLUG=dekalb-arts npx tsx scripts/demo-reset.ts
 *
 * Idempotent and re-runnable: run it right before the meeting, and again if a
 * walkthrough leaves the board messy.
 *
 * Target board:
 *   Present 40 · Attendance not marked 0 · Absent 2 · Awaiting release 3
 *   Needs approval 1 · Late pickups 0 · Families with balances 3
 *
 * The one held pickup is deliberate. It is the live safety story: an adult who
 * is not on the approved list asked for a child, the system held it and texted
 * the parent, and nobody was released. That is much better shown than described.
 *
 * Everything here goes through the real write paths (markStudent,
 * createPickupRequest) rather than inserting rows, because those are the only
 * paths that write the hash-chained audit entries. The Activity record panel is
 * the most persuasive thing on the dashboard and it would be empty otherwise.
 */
import { prisma } from '../src/lib/prisma';
import { markStudent } from '../src/lib/rollcall';
import { createPickupRequest } from '../src/lib/pickup';
import { todayInTz } from '../src/lib/dates';
import { drainOutbox } from '../src/lib/outbox';

const SLUG = process.env.DEFAULT_TENANT_SLUG || 'dekalb-arts';
// Households this script is allowed to touch. 'demo-seed' is the synthetic
// roster; 'jab-test' is the Jordan/Borden pair used for real end-to-end phone
// tests. Both must be included or their students count as "attendance not
// marked" on the dashboard and the board never reads clean.
const OURS = ['demo-seed', 'jab-test'];
const DEMO = 'demo-seed';

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const date = todayInTz(tenant.timezone);

  // ---- guard: never reshape a day that has real families in it ----
  // The OR is load-bearing: `notes: { not: DEMO }` alone is NULL for a NULL
  // notes column, so every real family would be invisible to this check.
  const realActivity = await prisma.attendanceRecord.count({
    where: {
      tenantId: tenant.id,
      date,
      student: { household: { OR: [{ notes: null }, { notes: { notIn: OURS } }] } },
    },
  });
  if (realActivity > 0 && process.env.ALLOW_LIVE_TENANT !== '1') {
    console.error(
      `\nREFUSING TO RUN. ${realActivity} attendance record(s) exist today for non-demo families ` +
        `in "${tenant.slug}".\nThis script rewrites today's pickup state. Set ALLOW_LIVE_TENANT=1 ` +
        `only if you are certain.\n`,
    );
    process.exit(2);
  }

  const admin = await prisma.staffUser.findFirstOrThrow({
    where: { tenantId: tenant.id, role: 'ADMIN' },
  });
  const actor = { staffId: admin.id, name: admin.name, role: 'ADMIN' };
  const demoWhere = { household: { tenantId: tenant.id, notes: { in: OURS } } };

  // ---- 1. clear today, scoped to the demo families ----
  await prisma.pickupApproval.deleteMany({ where: { request: demoWhere } });
  await prisma.pickupRequestStudent.deleteMany({ where: { request: { ...demoWhere, date } } });
  await prisma.pickupRequest.deleteMany({ where: { ...demoWhere, date } });
  await prisma.attendanceRecord.deleteMany({
    where: { tenantId: tenant.id, date, student: { household: { notes: { in: OURS } } } },
  });
  await prisma.authorizedAdult.updateMany({
    where: { household: { tenantId: tenant.id, notes: { in: OURS } }, createdVia: 'KIOSK_REQUEST' },
    data: { status: 'REVOKED' },
  });

  // ---- 2. clear undelivered texts ----
  // Nothing else in the codebase ever clears these, and every demo message to a
  // 555 number used to fail four times and stay FAILED forever. The outbox now
  // skips those numbers outright, so this only has to mop up the backlog once.
  const wiped = await prisma.messageOutbox.deleteMany({
    where: { tenantId: tenant.id, status: { in: ['FAILED', 'SKIPPED'] } },
  });

  // ---- 3. exactly three families with a balance ----
  const owing = await prisma.household.findMany({
    where: { tenantId: tenant.id, notes: DEMO, balanceCents: { gt: 0 } },
    orderBy: { name: 'asc' },
  });
  for (const h of owing.slice(3)) {
    await prisma.household.update({
      where: { id: h.id },
      data: { balanceCents: 0, balanceNote: null },
    });
  }

  // ---- 4. roll call: everyone in, two absent, nobody unmarked ----
  const students = await prisma.student.findMany({
    where: { tenantId: tenant.id, active: true, household: { notes: { in: OURS } } },
    include: { household: { include: { guardians: { where: { isPrimary: true }, take: 1 } } } },
    orderBy: [{ grade: 'asc' }, { firstName: 'asc' }],
  });
  const absent = students.slice(0, 2);
  const present = students.slice(2);
  for (const s of absent) await markStudent(tenant, s.id, 'ABSENT', actor);
  for (const s of present) await markStudent(tenant, s.id, 'CHECK_IN', actor);

  // ---- 5. three ordinary pickups waiting ----
  // Each from a different family, requested by that family's own primary
  // guardian so it passes authorization and lands as a normal request.
  const withGuardian = present.filter((s) => s.household.guardians[0]);
  const seen = new Set<string>();
  const pickFamilies = withGuardian.filter((s) => {
    if (seen.has(s.householdId)) return false;
    seen.add(s.householdId);
    return true;
  });

  let waiting = 0;
  let cursor = 0;
  while (waiting < 3 && cursor < pickFamilies.length) {
    const s = pickFamilies[cursor++];
    const g = s.household.guardians[0];
    try {
      await createPickupRequest({
        tenant,
        householdId: s.householdId,
        studentIds: [s.id],
        requesterName: `${g.firstName} ${g.lastName}`,
        requesterGuardianId: g.id,
        method: 'QR',
        dismissalMethod: 'CARLINE',
      });
      waiting++;
    } catch {
      // A restricted family refuses here; move to the next one.
    }
  }

  // ---- 6. one held pickup: the safety story ----
  // An adult nobody has approved asks for a child. The system holds it, texts
  // the parent, and releases no one.
  //
  // Continues from `cursor`, so this always lands on a family that does not
  // already have a live request. A student with one in flight would be
  // rejected outright and the demo would show no held pickup at all.
  let held = 0;
  while (held < 1 && cursor < pickFamilies.length) {
    const s = pickFamilies[cursor++];
    try {
      const r = await createPickupRequest({
        tenant,
        householdId: s.householdId,
        studentIds: [s.id],
        requesterName: 'Denise Carter',
        method: 'SEARCH',
        dismissalMethod: 'CARLINE',
      });
      if (r.status === 'NEEDS_APPROVAL') held++;
    } catch {
      // move to the next family
    }
  }

  // Settle the queue before we report. createPickupRequest fires drainSoon(),
  // and that background drain would otherwise still be running when this script
  // disconnects, which prints a scary (but harmless) Prisma engine error.
  await drainOutbox(100);

  // ---- report ----
  const [p, a, unmarked, live, needs, late, bal] = await Promise.all([
    prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'CHECKED_IN' } }),
    prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'ABSENT' } }),
    prisma.student.count({
      where: { tenantId: tenant.id, active: true, attendance: { none: { date } } },
    }),
    prisma.pickupRequestStudent.count({
      where: {
        request: { tenantId: tenant.id, date },
        status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] },
      },
    }),
    prisma.pickupRequest.count({ where: { tenantId: tenant.id, date, status: 'NEEDS_APPROVAL' } }),
    prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'RELEASED_LATE' } }),
    prisma.household.count({ where: { tenantId: tenant.id, balanceCents: { gt: 0 } } }),
  ]);

  console.log('');
  console.log(`Demo reset for ${tenant.name}, ${date}`);
  console.log(`  cleared ${wiped.count} undelivered text record(s)`);
  console.log('');
  console.log(`  Present                  ${p}`);
  console.log(`  Attendance not marked    ${unmarked}`);
  console.log(`  Absent                   ${a}`);
  console.log(`  Awaiting release         ${live}   (includes the held one)`);
  console.log(`  Needs approval           ${needs}`);
  console.log(`  Late pickups             ${late}`);
  console.log(`  Families with balances   ${bal}`);
  console.log('');
  if (unmarked || late) console.log('  NOTE: unmarked or late is non-zero; the board will show a warning colour.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
