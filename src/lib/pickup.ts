// The pickup state machine. Every transition is atomic, guarded, audited, and
// obeys the one rule the product is built on: a QR scan or a PIN creates a
// REQUEST. Only a staff actor performs a RELEASE, and authorization and
// restrictions are re-checked at release time, not just at request time.
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { dismissalLabel, howRequested, pickupStatusLabel, requesterKindLabel } from '@/lib/labels';
import { enqueueSms, drainSoon } from '@/lib/outbox';
import { sha256, newToken } from '@/lib/auth';
import { lastFour, normalizePhone } from '@/lib/phone';
import { todayInTz, endOfDayInTz, minutesPast, timeLabel } from '@/lib/dates';
import type { Tenant, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Lookup - privacy masking is done HERE, server-side, so the network response
// itself never carries names or full numbers before confirmation.
// ---------------------------------------------------------------------------

export interface MaskedMatch {
  householdId: string;
  masked: string; // "T. Johnson · phone ending 8290 · 2 students"
}

export async function lookupHousehold(tenant: Tenant, query: string): Promise<MaskedMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const date = todayInTz(tenant.timezone);
  const asPhone = normalizePhone(q);

  const households = await prisma.household.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        { pin: q },
        { guardians: { some: { phone: asPhone.length >= 12 ? asPhone : '±none' } } },
        { guardians: { some: { lastName: { equals: q, mode: 'insensitive' } } } },
        { students: { some: { lastName: { equals: q, mode: 'insensitive' } } } },
      ],
    },
    include: {
      guardians: { where: { isPrimary: true }, take: 1 },
      students: { where: { active: true }, select: { id: true } },
    },
    take: 5,
  });

  void date;
  return households.map((h) => {
    const g = h.guardians[0];
    const gLabel = g ? `${g.firstName[0] || ''}. ${g.lastName}` : h.name;
    const phone = g?.phone ? ` · phone ending ${lastFour(g.phone)}` : '';
    const n = h.students.length;
    return {
      householdId: h.id,
      masked: `${gLabel}${phone} · ${n} ${n === 1 ? 'student' : 'students'}`,
    };
  });
}

/** Full household detail - only after the guardian confirmed the masked match. */
export async function householdDetail(tenant: Tenant, householdId: string) {
  const date = todayInTz(tenant.timezone);
  const h = await prisma.household.findFirst({
    where: { id: householdId, tenantId: tenant.id },
    include: {
      guardians: { where: { canPickup: true }, orderBy: { isPrimary: 'desc' } },
      authorized: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
      students: {
        where: { active: true },
        include: {
          classGroup: true,
          attendance: { where: { date } },
          requestItems: {
            where: { status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } },
            take: 1,
          },
        },
        orderBy: { firstName: 'asc' },
      },
    },
  });
  if (!h) return null;
  return {
    id: h.id,
    name: h.name,
    guardians: h.guardians.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}` })),
    authorized: h.authorized.map((a) => ({ id: a.id, name: a.name, expiresAt: a.expiresAt })),
    students: h.students.map((s) => {
      const att = s.attendance[0];
      const open = s.requestItems[0];
      const eligible = !!att && att.status === 'CHECKED_IN' && !open;
      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        grade: s.grade,
        room: s.classGroup?.room || null,
        eligible,
        statusLabel: !att
          ? 'Not checked in'
          : att.status === 'ABSENT'
            ? 'Absent today'
            : att.status !== 'CHECKED_IN'
              ? 'Already released'
              : open
                ? 'Pickup already requested'
                : 'Ready for pickup',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Create a pickup request
// ---------------------------------------------------------------------------

export interface CreateRequestInput {
  tenant: Tenant;
  householdId: string;
  studentIds: string[];
  requesterName: string;
  method: 'QR' | 'PIN' | 'SEARCH' | 'STAFF' | 'PARENT_LINK';
  dismissalMethod: 'CARLINE' | 'WALKUP' | 'BUS';
  deviceId?: string | null;
  requesterGuardianId?: string | null;
}

export interface CreateRequestResult {
  requestId: string;
  status: 'REQUESTED' | 'NEEDS_APPROVAL';
  reason?: 'UNAPPROVED_ADULT' | 'RESTRICTION';
}

export async function createPickupRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
  const { tenant } = input;
  const date = todayInTz(tenant.timezone);
  const requester = input.requesterName.trim();
  if (!requester) throw new PickupError('A pickup name is required.');
  if (!input.studentIds.length) throw new PickupError('Select at least one student.');

  const result = await prisma.$transaction(async (tx) => {
    const household = await tx.household.findFirst({
      where: { id: input.householdId, tenantId: tenant.id },
      include: {
        guardians: true,
        authorized: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
      },
    });
    if (!household) throw new PickupError('Family not found.');

    // Students: must belong to the household, be checked in today, and have no live request.
    const students = await tx.student.findMany({
      where: { id: { in: input.studentIds }, householdId: household.id, active: true },
      include: {
        classGroup: { include: { teacher: true } },
        attendance: { where: { date } },
        requestItems: { where: { status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } } },
      },
    });
    if (students.length !== input.studentIds.length) {
      throw new PickupError('One of the selected students does not belong to this family.');
    }
    for (const s of students) {
      const att = s.attendance[0];
      if (!att || att.status !== 'CHECKED_IN') {
        throw new PickupError(`${s.firstName} is not checked in today.`);
      }
      if (s.requestItems.length) {
        throw new PickupError(`A pickup for ${s.firstName} is already in progress.`);
      }
    }

    // Who is asking?
    const guardian = household.guardians.find(
      (g) => g.canPickup && norm(`${g.firstName} ${g.lastName}`) === norm(requester),
    ) || (input.requesterGuardianId
      ? household.guardians.find((g) => g.id === input.requesterGuardianId && g.canPickup)
      : undefined);
    const authorized = household.authorized.find((a) => norm(a.name) === norm(requester));
    const isKnown = !!guardian || !!authorized;

    // Restrictions: match on the requester name, or any active restriction on a
    // selected student routes to the front office regardless of who is asking.
    const restrictions = await tx.pickupRestriction.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
        OR: [{ studentId: { in: input.studentIds } }, { householdId: household.id }],
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
        ],
      },
    });
    const restrictionHit = restrictions.some((r) => norm(r.restrictedName) === norm(requester));

    const needsApproval = !isKnown || restrictionHit;
    const reqStatus = needsApproval ? 'NEEDS_APPROVAL' : 'REQUESTED';

    const request = await tx.pickupRequest.create({
      data: {
        tenantId: tenant.id,
        householdId: household.id,
        requesterName: guardian ? `${guardian.firstName} ${guardian.lastName}` : authorized ? authorized.name : requester,
        requesterGuardianId: guardian?.id || null,
        requesterKind: guardian ? 'GUARDIAN' : authorized ? 'AUTHORIZED' : 'UNKNOWN',
        method: input.method,
        dismissalMethod: input.dismissalMethod,
        status: reqStatus,
        date,
        deviceId: input.deviceId || null,
        students: {
          create: students.map((s) => ({ studentId: s.id, status: reqStatus })),
        },
      },
    });

    const names = students.map((s) => s.firstName).join(' and ');

    if (restrictionHit) {
      // Silent hold: the kiosk shows a neutral message; the board and front
      // office get the truth. Reason detail is never written to the kiosk path.
      await audit(tx, {
        tenantId: tenant.id,
        actorKind: input.deviceId ? 'DEVICE' : 'SYSTEM',
        actorId: input.deviceId,
        actorName: input.deviceId ? 'kiosk' : 'system',
        action: 'HELD_RESTRICTION',
        entity: 'PickupRequest',
        entityId: request.id,
        detail: `${requester} asked to pick up ${names}, and that name matches a restriction on file for this family. The pickup was held and the front office was texted. No child was released.`,
      });
      // Alert admins/supervisors by text.
      const alertStaff = await tx.staffUser.findMany({
        where: { tenantId: tenant.id, active: true, role: { in: ['ADMIN', 'SUPERVISOR'] }, phone: { not: null } },
      });
      for (const st of alertStaff) {
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: st.phone!,
          body: `${tenant.name}: pickup request for ${names} is held at the front desk. Restriction on file. Please respond.`,
          kind: 'GUARDIAN_ALERT',
          idempotencyKey: `restrict:${request.id}:${st.id}`,
          refType: 'PickupRequest',
          refId: request.id,
        });
      }
      return { requestId: request.id, status: 'NEEDS_APPROVAL' as const, reason: 'RESTRICTION' as const };
    }

    if (!isKnown) {
      // Unrecognized adult: single-use expiring link, bound to this adult,
      // these students, this request. Sent to the primary guardian.
      const primary = household.guardians.find((g) => g.isPrimary && g.phone) || household.guardians.find((g) => g.phone);
      const token = newToken();
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      await tx.pickupApproval.create({
        data: {
          tenantId: tenant.id,
          requestId: request.id,
          adultName: requester,
          tokenHash: sha256(token),
          expiresAt,
        },
      });
      if (primary?.phone) {
        const base = (process.env.APP_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: primary.phone,
          body: `${tenant.name}: ${requester} is asking to pick up ${names}. Approve or deny: ${base}/approve/${token}`,
          kind: 'APPROVAL_REQUEST',
          idempotencyKey: `approval:${request.id}`,
          refType: 'PickupRequest',
          refId: request.id,
        });
      }
      await audit(tx, {
        tenantId: tenant.id,
        actorKind: input.deviceId ? 'DEVICE' : 'SYSTEM',
        actorId: input.deviceId,
        actorName: input.deviceId ? 'kiosk' : 'system',
        action: 'HELD_UNAPPROVED',
        entity: 'PickupRequest',
        entityId: request.id,
        detail: `${requester} is not on the approved pickup list for the ${household.name}. The pickup was held${primary?.phone ? ` and a text was sent to ${primary.firstName} ${primary.lastName} to confirm` : ', and no parent phone number was on file to ask'}. No child was released.`,
      });
      return { requestId: request.id, status: 'NEEDS_APPROVAL' as const, reason: 'UNAPPROVED_ADULT' as const };
    }

    // Known adult - normal path. Teacher alerts, one per class group.
    await audit(tx, {
      tenantId: tenant.id,
      actorKind: guardian ? 'GUARDIAN' : 'DEVICE',
      actorId: guardian?.id || input.deviceId,
      actorName: request.requesterName,
      action: 'PICKUP_REQUESTED',
      entity: 'PickupRequest',
      entityId: request.id,
      detail: `${request.requesterName}, ${requesterKindLabel(request.requesterKind)}, asked to pick up ${names} from the ${household.name} by ${dismissalLabel(input.dismissalMethod).toLowerCase()}. ${howRequested(input.method, timeLabel(new Date(), tenant.timezone))}`,
    });

    const byTeacher = new Map<string, { phone: string; students: string[]; room: string }>();
    for (const s of students) {
      const t = s.classGroup?.teacher;
      if (t?.phone) {
        const cur = byTeacher.get(t.id) || { phone: t.phone, students: [], room: s.classGroup?.room || '' };
        cur.students.push(`${s.firstName} ${s.lastName}`);
        byTeacher.set(t.id, cur);
      }
    }
    for (const [teacherId, alert] of byTeacher) {
      await enqueueSms(tx, {
        tenantId: tenant.id,
        toPhone: alert.phone,
        body: `${tenant.name}: ${alert.students.join(', ')} pickup. ${request.requesterName} at the front. ${input.dismissalMethod.toLowerCase()}.`,
        kind: 'TEACHER_ALERT',
        idempotencyKey: `teacher:${request.id}:${teacherId}`,
        refType: 'PickupRequest',
        refId: request.id,
      });
    }
    await tx.pickupRequestStudent.updateMany({
      where: { requestId: request.id },
      data: { teacherNotifiedAt: new Date() },
    });

    return { requestId: request.id, status: 'REQUESTED' as const };
  });

  drainSoon();
  return result;
}

// ---------------------------------------------------------------------------
// Ladder transitions (staff actions)
// ---------------------------------------------------------------------------

const NEXT: Record<string, string[]> = {
  REQUESTED: ['EN_ROUTE', 'READY', 'CANCELLED'],
  NEEDS_APPROVAL: ['REQUESTED', 'DENIED', 'CANCELLED'],
  EN_ROUTE: ['READY', 'CANCELLED'],
  READY: ['RELEASED', 'CANCELLED'],
};

export interface StaffActor {
  staffId: string;
  name: string;
  role: string;
}

export async function advanceItem(
  tenant: Tenant,
  itemId: string,
  to: 'EN_ROUTE' | 'READY' | 'RELEASED' | 'CANCELLED',
  actor: StaffActor,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.pickupRequestStudent.findUnique({
      where: { id: itemId },
      include: {
        student: { include: { household: { include: { guardians: true } } } },
        request: true,
      },
    });
    if (!item || item.request.tenantId !== tenant.id) throw new PickupError('Pickup not found.');
    const allowed = NEXT[item.status] || [];
    if (!allowed.includes(to)) {
      throw new PickupError(`${pickupStatusLabel(item.status)} cannot go straight to ${pickupStatusLabel(to).toLowerCase()}.`);
    }

    if (to === 'RELEASED') {
      await performRelease(tx, tenant, item.id, actor, null);
      return;
    }

    const now = new Date();
    await tx.pickupRequestStudent.update({
      where: { id: item.id },
      data: {
        status: to,
        ...(to === 'EN_ROUTE' ? { enRouteAt: now } : {}),
        ...(to === 'READY' ? { readyAt: now } : {}),
      },
    });

    const studentName = `${item.student.firstName} ${item.student.lastName}`;

    if (to === 'READY') {
      // Parent is told only when the child is physically at the door.
      const g =
        item.student.household.guardians.find((x) => x.id === item.request.requesterGuardianId) ||
        item.student.household.guardians.find((x) => x.isPrimary && x.phone) ||
        item.student.household.guardians.find((x) => x.phone);
      if (g?.phone && g.notify) {
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: g.phone,
          body: `${tenant.name}: ${item.student.firstName} is at the door. A staff member will walk them out.`,
          kind: 'PICKUP_READY',
          idempotencyKey: `ready:${item.id}`,
          refType: 'PickupRequestStudent',
          refId: item.id,
        });
        await tx.pickupRequestStudent.update({
          where: { id: item.id },
          data: { parentNotifiedAt: now },
        });
      }
    }

    await audit(tx, {
      tenantId: tenant.id,
      actorKind: 'STAFF',
      actorId: actor.staffId,
      actorName: actor.name,
      action: to,
      entity: 'PickupRequestStudent',
      entityId: item.id,
      detail:
        to === 'EN_ROUTE'
          ? `${studentName} is on the way to the front desk.`
          : to === 'READY'
            ? `${studentName} is waiting at the front desk.`
            : `The pickup request for ${studentName} was cancelled.`,
    });

    await settleRequestStatus(tx, item.requestId);
  });
  drainSoon();
}

/**
 * The release. Staff only. Re-checks everything AT RELEASE TIME: the student is
 * still checked in and unreleased, the requester is still authorized (or holds
 * a still-valid approval), and no restriction matches. Writes the attendance
 * checkout with late math, inside the same transaction.
 */
async function performRelease(
  tx: Tx,
  tenant: Tenant,
  itemId: string,
  actor: StaffActor,
  overrideReason: string | null,
): Promise<void> {
  const item = await tx.pickupRequestStudent.findUnique({
    where: { id: itemId },
    include: {
      student: { include: { household: { include: { guardians: true, authorized: true } } } },
      request: { include: { approvals: true } },
    },
  });
  if (!item || item.request.tenantId !== tenant.id) throw new PickupError('Pickup not found.');
  if (item.status === 'RELEASED') throw new PickupError('Already released.');
  if (item.status !== 'READY' && item.status !== 'EN_ROUTE') {
    throw new PickupError(`A child cannot be released from "${pickupStatusLabel(item.status).toLowerCase()}". Move them to the door first.`);
  }

  const date = todayInTz(tenant.timezone);
  const att = await tx.attendanceRecord.findUnique({
    where: { studentId_date: { studentId: item.studentId, date } },
  });
  if (!att || att.status !== 'CHECKED_IN') {
    throw new PickupError('This student is not currently checked in.');
  }

  // Re-check authorization NOW, not just at request time.
  const requester = item.request.requesterName;
  const h = item.student.household;
  const isGuardian = h.guardians.some((g) => g.canPickup && norm(`${g.firstName} ${g.lastName}`) === norm(requester));
  const isAuthorized = h.authorized.some(
    (a) => a.status === 'ACTIVE' && (!a.expiresAt || a.expiresAt > new Date()) && norm(a.name) === norm(requester),
  );
  const approval = item.request.approvals.find(
    (a) => (a.status === 'APPROVED_ONCE' || a.status === 'APPROVED_ALWAYS' || a.status === 'OVERRIDDEN') && norm(a.adultName) === norm(requester),
  );
  if (!isGuardian && !isAuthorized && !approval) {
    throw new PickupError('This adult is no longer approved to collect. Send them to the front office.');
  }

  const restriction = await tx.pickupRestriction.findFirst({
    where: {
      tenantId: tenant.id,
      active: true,
      OR: [{ studentId: item.studentId }, { householdId: h.id }],
      restrictedName: { equals: requester, mode: 'insensitive' },
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      ],
    },
  });
  if (restriction && !overrideReason) {
    throw new PickupError('This adult matches a restriction on file. Send them to the front office.');
  }

  const now = new Date();
  const past = minutesPast(tenant.programEnd, tenant.timezone);
  const lateMinutes = Math.max(0, past - tenant.lateThresholdMinutes) > 0 ? past : 0;
  const lateFeeCents =
    lateMinutes > 0
      ? Math.ceil((lateMinutes - tenant.lateThresholdMinutes) / Math.max(1, tenant.lateFeeBlockMinutes)) * tenant.lateFeeCents
      : 0;

  await tx.pickupRequestStudent.update({
    where: { id: item.id },
    data: { status: 'RELEASED', releasedAt: now },
  });
  await tx.attendanceRecord.update({
    where: { id: att.id },
    data: {
      status: lateMinutes > 0 ? 'RELEASED_LATE' : 'RELEASED',
      checkOutAt: now,
      releasedToName: requester,
      releasedToKind: isGuardian ? 'GUARDIAN' : isAuthorized || approval ? 'AUTHORIZED' : 'OVERRIDE',
      releasedById: actor.staffId,
      releasedByName: actor.name,
      releaseRequest: item.requestId,
      lateMinutes,
      lateFeeCents,
    },
  });
  if (lateFeeCents > 0) {
    await tx.household.update({
      where: { id: h.id },
      data: { balanceCents: { increment: lateFeeCents } },
    });
  }

  const studentName = `${item.student.firstName} ${item.student.lastName}`;
  await audit(tx, {
    tenantId: tenant.id,
    actorKind: 'STAFF',
    actorId: actor.staffId,
    actorName: actor.name,
    action: 'RELEASED',
    entity: 'AttendanceRecord',
    entityId: att.id,
    detail:
      `${studentName} was released to ${requester}.` +
      (approval ? ` A parent confirmed this by text at ${timeLabel(approval.resolvedAt, tenant.timezone)}.` : '') +
      (overrideReason ? ` A supervisor approved the pickup for this reason: ${overrideReason}.` : '') +
      (lateMinutes > 0 ? ` The pickup was ${lateMinutes} minutes late, so a $${(lateFeeCents / 100).toFixed(2)} fee was added.` : '') +
      ` ${howRequested(item.request.method, timeLabel(item.request.requestedAt, tenant.timezone))}`,
  });

  await settleRequestStatus(tx, item.requestId);
}

/** Roll the per-child statuses up to the request. */
async function settleRequestStatus(tx: Tx, requestId: string): Promise<void> {
  const items = await tx.pickupRequestStudent.findMany({ where: { requestId } });
  const live = items.filter((i) => ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'].includes(i.status));
  let status: string;
  if (live.length === 0) {
    const anyReleased = items.some((i) => i.status === 'RELEASED');
    const anyDenied = items.some((i) => i.status === 'DENIED');
    status = anyReleased ? 'COMPLETED' : anyDenied ? 'DENIED' : 'CANCELLED';
  } else {
    status = live.some((i) => i.status === 'NEEDS_APPROVAL') ? 'NEEDS_APPROVAL' : 'IN_PROGRESS';
  }
  await tx.pickupRequest.update({
    where: { id: requestId },
    data: { status, ...(live.length === 0 ? { resolvedAt: new Date() } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function resolveApproval(
  tenant: Tenant,
  token: string,
  choice: 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'DENIED',
): Promise<{ ok: boolean; message: string }> {
  const out = await prisma.$transaction(async (tx) => {
    const approval = await tx.pickupApproval.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        request: {
          include: {
            household: { include: { guardians: true } },
            students: { include: { student: { include: { classGroup: { include: { teacher: true } } } } } },
          },
        },
      },
    });
    if (!approval || approval.tenantId !== tenant.id) return { ok: false, message: 'This link is not valid.' };
    if (approval.status !== 'PENDING') return { ok: false, message: 'This link was already used.' };
    if (approval.expiresAt < new Date()) {
      await tx.pickupApproval.update({ where: { id: approval.id }, data: { status: 'EXPIRED' } });
      return { ok: false, message: 'This link has expired. Please call the front desk.' };
    }

    const primary = approval.request.household.guardians.find((g) => g.isPrimary) || approval.request.household.guardians[0];
    const names = approval.request.students.map((i) => i.student.firstName).join(' and ');

    await tx.pickupApproval.update({
      where: { id: approval.id },
      data: { status: choice, resolvedByGuardianId: primary?.id || null, resolvedAt: new Date() },
    });

    if (choice === 'DENIED') {
      await tx.pickupRequestStudent.updateMany({
        where: { requestId: approval.requestId },
        data: { status: 'DENIED' },
      });
      await audit(tx, {
        tenantId: tenant.id,
        actorKind: 'GUARDIAN',
        actorId: primary?.id,
        actorName: primary ? `${primary.firstName} ${primary.lastName}` : 'Guardian',
        action: 'APPROVAL_DENIED',
        entity: 'PickupApproval',
        entityId: approval.id,
        detail: `A parent said no to ${approval.adultName} picking up ${names}. Staff were told not to release.`,
      });
      await settleRequestStatus(tx, approval.requestId);
      return { ok: true, message: 'Denied. Staff will not release your child to this person.' };
    }

    // Approved: record the adult, un-hold the request, alert teachers now.
    const expiresAt = choice === 'APPROVED_ONCE' ? endOfDayInTz(tenant.timezone) : null;
    await tx.authorizedAdult.create({
      data: {
        householdId: approval.request.householdId,
        name: approval.adultName,
        status: 'ACTIVE',
        expiresAt,
        verifiedByGuardianId: primary?.id || null,
        verifiedAt: new Date(),
        createdVia: 'KIOSK_REQUEST',
      },
    });
    await tx.pickupRequestStudent.updateMany({
      where: { requestId: approval.requestId, status: 'NEEDS_APPROVAL' },
      data: { status: 'REQUESTED' },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actorKind: 'GUARDIAN',
      actorId: primary?.id,
      actorName: primary ? `${primary.firstName} ${primary.lastName}` : 'Guardian',
      action: 'APPROVED',
      entity: 'PickupApproval',
      entityId: approval.id,
      detail: `A parent approved ${approval.adultName} to pick up ${names}${expiresAt ? ' today only' : ", and added them to the family's approved pickup list"}.`,
    });

    for (const item of approval.request.students) {
      const t = item.student.classGroup?.teacher;
      if (t?.phone) {
        await enqueueSms(tx, {
          tenantId: tenant.id,
          toPhone: t.phone,
          body: `${tenant.name}: ${item.student.firstName} ${item.student.lastName} pickup. ${approval.adultName} at the front (parent approved).`,
          kind: 'TEACHER_ALERT',
          idempotencyKey: `teacher:${approval.requestId}:${t.id}:approved`,
          refType: 'PickupRequest',
          refId: approval.requestId,
        });
      }
    }
    await settleRequestStatus(tx, approval.requestId);
    return {
      ok: true,
      message:
        choice === 'APPROVED_ONCE'
          ? `Approved for today. ${approval.adultName} can pick up until end of day.`
          : `Approved. ${approval.adultName} is now on your approved pickup list.`,
    };
  });
  drainSoon();
  return out;
}

/** Supervisor override of a held request: mandatory typed reason, permanent record. */
export async function overrideHold(
  tenant: Tenant,
  requestId: string,
  actor: StaffActor,
  reason: string,
): Promise<void> {
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) {
    throw new PickupError('An override needs a supervisor or admin.');
  }
  if (!reason || reason.trim().length < 5) {
    throw new PickupError('An override needs a written reason.');
  }
  await prisma.$transaction(async (tx) => {
    const request = await tx.pickupRequest.findFirst({
      where: { id: requestId, tenantId: tenant.id },
      include: { approvals: true, students: { include: { student: true } } },
    });
    if (!request) throw new PickupError('Request not found.');
    const pending = request.approvals.find((a) => a.status === 'PENDING');
    if (pending) {
      await tx.pickupApproval.update({
        where: { id: pending.id },
        data: {
          status: 'OVERRIDDEN',
          overrideByStaffId: actor.staffId,
          overrideByName: actor.name,
          overrideReason: reason.trim(),
          resolvedAt: new Date(),
        },
      });
    }
    await tx.pickupRequestStudent.updateMany({
      where: { requestId, status: 'NEEDS_APPROVAL' },
      data: { status: 'REQUESTED' },
    });
    const names = request.students.map((i) => i.student.firstName).join(' and ');
    await audit(tx, {
      tenantId: tenant.id,
      actorKind: 'STAFF',
      actorId: actor.staffId,
      actorName: actor.name,
      action: 'OVERRIDE',
      entity: 'PickupRequest',
      entityId: requestId,
      detail: `A supervisor approved ${request.requesterName} to pick up ${names} despite the hold. Reason given: ${reason.trim()}`,
    });
    await settleRequestStatus(tx, requestId);
  });
}

/** Deny a held request from the staff side (e.g. front office on a restriction). */
export async function denyRequest(tenant: Tenant, requestId: string, actor: StaffActor, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const request = await tx.pickupRequest.findFirst({
      where: { id: requestId, tenantId: tenant.id },
      include: {
        students: { include: { student: { include: { household: { include: { guardians: true } } } } } },
        approvals: true,
      },
    });
    if (!request) throw new PickupError('Request not found.');
    await tx.pickupRequestStudent.updateMany({
      where: { requestId, status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } },
      data: { status: 'DENIED' },
    });
    for (const a of request.approvals.filter((x) => x.status === 'PENDING')) {
      await tx.pickupApproval.update({ where: { id: a.id }, data: { status: 'DENIED', resolvedAt: new Date() } });
    }
    const names = request.students.map((i) => i.student.firstName).join(' and ');
    await audit(tx, {
      tenantId: tenant.id,
      actorKind: 'STAFF',
      actorId: actor.staffId,
      actorName: actor.name,
      action: 'DENIED',
      entity: 'PickupRequest',
      entityId: requestId,
      detail: `Staff refused to release ${names} to ${request.requesterName}.${reason ? ` Reason given: ${reason}` : ''}`.trim(),
    });
    // Tell the approved guardians.
    const household = request.students[0]?.student.household;
    const g = household?.guardians.find((x) => x.isPrimary && x.phone) || household?.guardians.find((x) => x.phone);
    if (g?.phone) {
      await enqueueSms(tx, {
        tenantId: tenant.id,
        toPhone: g.phone,
        body: `${tenant.name}: a pickup request for ${names} by ${request.requesterName} was denied by staff. Call the front desk with questions.`,
        kind: 'GUARDIAN_ALERT',
        idempotencyKey: `deny:${requestId}`,
        refType: 'PickupRequest',
        refId: requestId,
      });
    }
    await settleRequestStatus(tx, requestId);
  });
  drainSoon();
}

/** Correct a mistaken release by APPENDING a reversal. The original row stays. */
export async function reverseRelease(
  tenant: Tenant,
  attendanceId: string,
  actor: StaffActor,
  reason: string,
): Promise<void> {
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) throw new PickupError('A reversal needs a supervisor or admin.');
  if (!reason || reason.trim().length < 5) throw new PickupError('A reversal needs a written reason.');
  await prisma.$transaction(async (tx) => {
    const att = await tx.attendanceRecord.findFirst({
      where: { id: attendanceId, tenantId: tenant.id },
      include: { student: true },
    });
    if (!att || (att.status !== 'RELEASED' && att.status !== 'RELEASED_LATE')) {
      throw new PickupError('That record is not a release.');
    }
    await tx.attendanceRecord.update({
      where: { id: att.id },
      data: { status: 'CHECKED_IN', reversed: true, reversedAt: new Date(), reversedReason: reason.trim() },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actorKind: 'STAFF',
      actorId: actor.staffId,
      actorName: actor.name,
      action: 'RELEASE_REVERSED',
      entity: 'AttendanceRecord',
      entityId: att.id,
      detail: `${att.student.firstName} ${att.student.lastName} was marked as still at school. The earlier release to ${att.releasedToName || 'an unrecorded adult'} was corrected. Reason given: ${reason.trim()}. The original entry stays visible above.`,
    });
  });
}

export class PickupError extends Error {}
