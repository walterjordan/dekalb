// Safety-rule verification, run with: npx tsx scripts/verify-safety.ts
// Exercises the pickup state machine directly against the live dev database.
// Every numbered assertion maps to the plan's "safety rules tested as assertions".
import { prisma } from '../src/lib/prisma';
import {
  createPickupRequest, advanceItem, resolveApproval, overrideHold,
  reverseRelease, PickupError, householdDetail, lookupHousehold,
} from '../src/lib/pickup';
import { markStudent } from '../src/lib/rollcall';
import { verifyChain } from '../src/lib/audit';
import { sha256 } from '../src/lib/auth';
import { todayInTz } from '../src/lib/dates';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
async function expectPickupError(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    ok(name, false, '(no error thrown)');
  } catch (e) {
    const m = e instanceof PickupError && (!match || match.test(e.message));
    ok(name, m, e instanceof Error ? `(${e.message})` : '');
  }
}

// Households these scripts own: the synthetic roster plus the Jordan/Borden
// pair used for real end-to-end phone tests. Must match scripts/demo-reset.ts,
// or checking in the test families here permanently trips the guard there (and
// vice versa).
const OURS = ['demo-seed', 'jab-test'];

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'dekalb-arts' } });
  const date = todayInTz(tenant.timezone);
  const admin = await prisma.staffUser.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'ADMIN' } });
  const staff = { staffId: admin.id, name: admin.name, role: 'STAFF' };
  const supervisor = { staffId: admin.id, name: admin.name, role: 'ADMIN' };

  // ---- guard: never touch real families ----
  //
  // This script runs against the LIVE database and its fixtures are the
  // `demo-seed` households. The cleanup below used to be tenant-wide, which
  // was harmless while the tenant held nothing but demo data and would have
  // deleted a real school day's attendance the moment a real roster landed.
  //
  // Two defences, because scoping alone is only as good as the next edit:
  //  1. every destructive query is scoped to demo-seed households, and
  //  2. this hard stop refuses to run at all if a NON-demo student already has
  //     attendance recorded today, which is the signature of a live school day.
  //
  // ALLOW_LIVE_TENANT=1 overrides, for the case where you genuinely mean it.
  // The OR is load-bearing. `notes: { not: 'demo-seed' }` alone compiles to
  // `notes <> 'demo-seed'`, which is NULL (not true) for a NULL notes column,
  // so every real family — none of which carry the demo marker — would be
  // silently invisible to this guard. Verified by tripping it deliberately.
  const realActivity = await prisma.attendanceRecord.count({
    where: {
      tenantId: tenant.id,
      date,
      student: { household: { OR: [{ notes: null }, { notes: { notIn: OURS } }] } },
    },
  });
  if (realActivity > 0 && process.env.ALLOW_LIVE_TENANT !== '1') {
    console.error(
      `\nREFUSING TO RUN. ${realActivity} attendance record(s) exist today for non-demo families in ` +
        `"${tenant.slug}".\nThat looks like a live school day, and this script deletes today's ` +
        `pickup state for its fixtures.\nRun it against a demo tenant, or set ALLOW_LIVE_TENANT=1 ` +
        `if you are certain.\n`,
    );
    process.exit(2);
  }

  // Clean any earlier verify-run state for today, scoped to the demo families
  // this script owns. PickupApproval and PickupRequestStudent cascade from
  // PickupRequest, so they are filtered through the request's household.
  const demoWhere = { household: { tenantId: tenant.id, notes: 'demo-seed' } };
  await prisma.pickupApproval.deleteMany({ where: { request: demoWhere } });
  await prisma.pickupRequestStudent.deleteMany({ where: { request: { ...demoWhere, date } } });
  await prisma.pickupRequest.deleteMany({ where: { ...demoWhere, date } });
  await prisma.attendanceRecord.deleteMany({
    where: { tenantId: tenant.id, date, student: { household: { notes: 'demo-seed' } } },
  });
  await prisma.authorizedAdult.updateMany({
    where: { household: { tenantId: tenant.id, notes: 'demo-seed' }, createdVia: 'KIOSK_REQUEST' },
    data: { status: 'REVOKED' },
  });

  // Households: [0] has Nina Patel (temp) + Marcus Webb restriction; use others for clean paths.
  const households = await prisma.household.findMany({
    where: { tenantId: tenant.id, notes: 'demo-seed' },
    include: { students: { where: { active: true } }, guardians: true, restrictions: true },
    orderBy: { name: 'asc' },
  });
  const restricted = households.find((h) => h.restrictions.length > 0)!;
  const multi = households.find((h) => h.students.length >= 2 && !h.restrictions.length)!;
  const single = households.find((h) => h.students.length === 1 && !h.restrictions.length && h.id !== multi.id)!;
  const g = (h: typeof multi) => h.guardians[0];
  const gname = (h: typeof multi) => `${g(h).firstName} ${g(h).lastName}`;

  console.log('\n-- roll call --');
  for (const st of [...multi.students, ...single.students, restricted.students[0]]) {
    await markStudent(tenant, st.id, 'CHECK_IN', supervisor);
  }
  const inCount = await prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: 'CHECKED_IN' } });
  ok('roll call checked students in', inCount >= 4, `(${inCount})`);
  await markStudent(tenant, multi.students[0].id, 'CHECK_IN', supervisor);
  const dupes = await prisma.attendanceRecord.count({ where: { studentId: multi.students[0].id, date } });
  ok('double check-in is idempotent (one row)', dupes === 1);

  console.log('\n-- 1. QR/PIN never releases; request only --');
  const det = await householdDetail(tenant, multi.id);
  ok('lookup masks: no student names in masked match', (await lookupHousehold(tenant, g(multi).lastName)).every((m) => !m.masked.includes(multi.students[0].firstName)));
  ok('detail shows eligible students', det!.students.some((s) => s.eligible));

  const req1 = await createPickupRequest({
    tenant, householdId: multi.id,
    studentIds: multi.students.slice(0, 2).map((s) => s.id),
    requesterName: gname(multi), method: 'QR', dismissalMethod: 'CARLINE',
  });
  ok('guardian request goes straight to REQUESTED', req1.status === 'REQUESTED');
  const released = await prisma.attendanceRecord.count({ where: { tenantId: tenant.id, date, status: { in: ['RELEASED', 'RELEASED_LATE'] } } });
  ok('a request alone produced ZERO released rows', released === 0);
  const teacherMsgs = await prisma.messageOutbox.count({ where: { tenantId: tenant.id, kind: 'TEACHER_ALERT', refId: req1.requestId } });
  ok('teacher alert enqueued in same tx', teacherMsgs >= 1, `(${teacherMsgs})`);

  console.log('\n-- 2. duplicate/ineligible requests rejected --');
  await expectPickupError('same student cannot have two live requests', () =>
    createPickupRequest({ tenant, householdId: multi.id, studentIds: [multi.students[0].id], requesterName: gname(multi), method: 'PIN', dismissalMethod: 'WALKUP' }),
    /already in progress/);
  const notCheckedIn = households.find((h) => !h.restrictions.length && h.id !== multi.id && h.id !== single.id)!;
  await expectPickupError('not-checked-in student cannot be requested', () =>
    createPickupRequest({ tenant, householdId: notCheckedIn.id, studentIds: [notCheckedIn.students[0].id], requesterName: gname(notCheckedIn), method: 'PIN', dismissalMethod: 'WALKUP' }),
    /not checked in/);
  await expectPickupError('student from another family is rejected', () =>
    createPickupRequest({ tenant, householdId: single.id, studentIds: [multi.students[0].id], requesterName: gname(single), method: 'PIN', dismissalMethod: 'WALKUP' }),
    /does not belong/);

  console.log('\n-- 3. ladder + release --');
  const items1 = await prisma.pickupRequestStudent.findMany({ where: { requestId: req1.requestId } });
  await expectPickupError('cannot RELEASE from REQUESTED (must be ready)', () =>
    advanceItem(tenant, items1[0].id, 'RELEASED', staff));
  await advanceItem(tenant, items1[0].id, 'EN_ROUTE', staff);
  await advanceItem(tenant, items1[0].id, 'READY', staff);
  const readyMsg = await prisma.messageOutbox.findFirst({ where: { kind: 'PICKUP_READY', refId: items1[0].id } });
  ok('parent "at the door" text enqueued on READY', !!readyMsg);
  await advanceItem(tenant, items1[0].id, 'RELEASED', staff);
  const att1 = await prisma.attendanceRecord.findUnique({ where: { studentId_date: { studentId: items1[0].studentId, date } } });
  ok('release wrote checkout with releaser + adult', !!att1?.releasedByName && att1.releasedToName === gname(multi));
  await expectPickupError('already-released cannot release again', () =>
    advanceItem(tenant, items1[0].id, 'RELEASED', staff));

  console.log('\n-- 4. unapproved adult: bound single-use link --');
  const req2 = await createPickupRequest({
    tenant, householdId: single.id, studentIds: [single.students[0].id],
    requesterName: 'Family Friend', method: 'SEARCH', dismissalMethod: 'WALKUP',
  });
  ok('unknown adult routes to NEEDS_APPROVAL', req2.status === 'NEEDS_APPROVAL' && req2.reason === 'UNAPPROVED_ADULT');
  const apMsg = await prisma.messageOutbox.findFirst({ where: { kind: 'APPROVAL_REQUEST', refId: req2.requestId } });
  ok('approval SMS enqueued to guardian', !!apMsg && apMsg.toPhone === g(single).phone);
  const tokenMatch = apMsg?.body.match(/\/approve\/([A-Za-z0-9_-]+)/);
  ok('SMS carries an approval link', !!tokenMatch);
  const rawToken = tokenMatch![1];
  const apRow = await prisma.pickupApproval.findFirst({ where: { requestId: req2.requestId } });
  ok('approval row stores sha256, not the raw token', apRow?.tokenHash === sha256(rawToken));

  const wrong = await resolveApproval(tenant, 'not-the-token', 'APPROVED_ONCE');
  ok('a wrong token cannot approve', wrong.ok === false);
  const good = await resolveApproval(tenant, rawToken, 'APPROVED_ONCE');
  ok('bound link approves', good.ok === true);
  const again = await resolveApproval(tenant, rawToken, 'APPROVED_ALWAYS');
  ok('link is single-use', again.ok === false && /already used/.test(again.message));
  const adult = await prisma.authorizedAdult.findFirst({ where: { householdId: single.id, name: 'Family Friend', status: 'ACTIVE' } });
  ok('today-only approval has an expiry', !!adult?.expiresAt);
  const item2 = await prisma.pickupRequestStudent.findFirst({ where: { requestId: req2.requestId } });
  ok('held item un-held after approval', item2?.status === 'REQUESTED');
  // Release re-check should now pass for this adult.
  await advanceItem(tenant, item2!.id, 'READY', staff);
  await advanceItem(tenant, item2!.id, 'RELEASED', staff);
  const att2 = await prisma.attendanceRecord.findUnique({ where: { studentId_date: { studentId: single.students[0].id, date } } });
  ok('release records AUTHORIZED kind for approved adult', att2?.releasedToKind === 'AUTHORIZED');

  console.log('\n-- 5. restriction: silent hold + supervisor-only override --');
  const req3 = await createPickupRequest({
    tenant, householdId: restricted.id, studentIds: [restricted.students[0].id],
    requesterName: 'Marcus Webb', method: 'PIN', dismissalMethod: 'WALKUP',
  });
  ok('restricted name routes to NEEDS_APPROVAL with RESTRICTION reason', req3.status === 'NEEDS_APPROVAL' && req3.reason === 'RESTRICTION');
  await expectPickupError('non-supervisor cannot override', () =>
    overrideHold(tenant, req3.requestId, staff, 'trying anyway'), /supervisor/);
  await expectPickupError('override without a reason is rejected', () =>
    overrideHold(tenant, req3.requestId, supervisor, ' '), /written reason/);
  // Even after an un-hold, the RELEASE-time re-check still blocks a restricted name.
  await overrideHold(tenant, req3.requestId, supervisor, 'Verified court doc expired; director approved (test)');
  const item3 = await prisma.pickupRequestStudent.findFirst({ where: { requestId: req3.requestId } });
  await advanceItem(tenant, item3!.id, 'READY', staff);
  await expectPickupError('release-time re-check still blocks restricted adult', () =>
    advanceItem(tenant, item3!.id, 'RELEASED', staff), /restriction|Front office/i);

  console.log('\n-- 6. reversal appends, never deletes --');
  await expectPickupError('reversal needs supervisor', () =>
    reverseRelease(tenant, att1!.id, staff, 'oops'), /supervisor/);
  await reverseRelease(tenant, att1!.id, supervisor, 'Wrong sibling walked out (test)');
  const attR = await prisma.attendanceRecord.findUnique({ where: { id: att1!.id } });
  ok('reversal keeps the row, flags reversed, returns to CHECKED_IN', !!attR?.reversed && attR.status === 'CHECKED_IN' && attR.releasedToName === gname(multi));

  console.log('\n-- 7. audit chain --');
  const broken = await verifyChain(tenant.id);
  ok('hash chain verifies end to end', broken === null, `(broken at ${broken})`);
  const audits = await prisma.auditLog.count({ where: { tenantId: tenant.id } });
  ok('audit rows were written throughout', audits > 15, `(${audits})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
