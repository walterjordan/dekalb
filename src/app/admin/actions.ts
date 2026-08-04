'use server';
// Admin server actions. Every mutation is audited. Deletes are soft
// (active:false) wherever history could reference the row.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { auditNow } from '@/lib/audit';
import { normalizePhone } from '@/lib/phone';
import { GRADES } from '@/lib/rollcall';

function s(fd: FormData, k: string): string {
  return String(fd.get(k) || '').trim();
}

async function ctx() {
  const session = await requireSession(['ADMIN', 'SUPERVISOR']);
  const tenant = await requireTenant();
  return { session, tenant };
}

async function ensureClassGroup(tenantId: string, grade: string): Promise<string> {
  const existing = await prisma.classGroup.findFirst({ where: { tenantId, grade, active: true } });
  if (existing) return existing.id;
  const created = await prisma.classGroup.create({
    data: { tenantId, grade, name: grade === 'K' ? 'Kindergarten' : `Grade ${grade}` },
  });
  return created.id;
}

function newPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function uniquePin(tenantId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const pin = newPin();
    const clash = await prisma.household.findUnique({ where: { tenantId_pin: { tenantId, pin } } });
    if (!clash) return pin;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---- students ----

export async function saveStudent(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  const grade = GRADES.includes(s(fd, 'grade') as (typeof GRADES)[number]) ? s(fd, 'grade') : 'K';
  const data = {
    firstName: s(fd, 'firstName'),
    lastName: s(fd, 'lastName'),
    grade,
    householdId: s(fd, 'householdId'),
    dismissalDefault: s(fd, 'dismissalDefault') || 'CARLINE',
    medicalNote: s(fd, 'medicalNote') || null,
    classGroupId: await ensureClassGroup(tenant.id, grade),
  };
  if (!data.firstName || !data.lastName || !data.householdId) return;
  if (id) {
    await prisma.student.update({ where: { id }, data });
  } else {
    const created = await prisma.student.create({ data: { ...data, tenantId: tenant.id } });
    await auditNow({
      tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
      action: 'STUDENT_ADDED', entity: 'Student', entityId: created.id,
      detail: `${data.firstName} ${data.lastName}, grade ${grade}.`,
    });
  }
  revalidatePath('/admin/students');
}

export async function deactivateStudent(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  const st = await prisma.student.update({ where: { id }, data: { active: false } });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'STUDENT_DEACTIVATED', entity: 'Student', entityId: id,
    detail: `${st.firstName} ${st.lastName} removed from the active roster.`,
  });
  revalidatePath('/admin/students');
}

// ---- families ----

export async function saveHousehold(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  if (id) {
    await prisma.household.update({
      where: { id },
      data: {
        name: s(fd, 'name'),
        balanceCents: Math.round(parseFloat(s(fd, 'balance') || '0') * 100) || 0,
        balanceNote: s(fd, 'balanceNote') || null,
      },
    });
  } else {
    const created = await prisma.household.create({
      data: { tenantId: tenant.id, name: s(fd, 'name'), pin: await uniquePin(tenant.id) },
    });
    await auditNow({
      tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
      action: 'FAMILY_ADDED', entity: 'Household', entityId: created.id, detail: `${created.name}.`,
    });
  }
  revalidatePath('/admin/families');
}

export async function saveGuardian(fd: FormData) {
  const { tenant } = await ctx();
  const id = s(fd, 'id');
  const data = {
    firstName: s(fd, 'firstName'),
    lastName: s(fd, 'lastName'),
    phone: s(fd, 'phone') ? normalizePhone(s(fd, 'phone')) : null,
    email: s(fd, 'email') || null,
    relationship: s(fd, 'relationship') || 'Parent',
    isPrimary: fd.get('isPrimary') === 'on',
  };
  if (!data.firstName || !data.lastName) return;
  if (id) {
    await prisma.guardian.update({ where: { id }, data });
  } else {
    const householdId = s(fd, 'householdId');
    if (!householdId) return;
    await prisma.guardian.create({ data: { ...data, householdId } });
  }
  void tenant;
  revalidatePath('/admin/families');
}

export async function saveAuthorizedAdult(fd: FormData) {
  const { session, tenant } = await ctx();
  const householdId = s(fd, 'householdId');
  const name = s(fd, 'name');
  if (!householdId || !name) return;
  const expires = s(fd, 'expiresAt');
  await prisma.authorizedAdult.create({
    data: {
      householdId,
      name,
      phone: s(fd, 'phone') ? normalizePhone(s(fd, 'phone')) : null,
      relationship: s(fd, 'relationship') || null,
      expiresAt: expires ? new Date(`${expires}T23:59:00`) : null,
      createdVia: 'ADMIN',
      verifiedAt: new Date(),
    },
  });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'ADULT_AUTHORIZED', entity: 'Household', entityId: householdId,
    detail: `${name} added to the approved pickup list${expires ? ` until ${expires}` : ' (permanent)'}.`,
  });
  revalidatePath('/admin/families');
}

export async function revokeAuthorizedAdult(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  const a = await prisma.authorizedAdult.update({ where: { id }, data: { status: 'REVOKED' } });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'ADULT_REVOKED', entity: 'Household', entityId: a.householdId,
    detail: `${a.name} removed from the approved pickup list. Effective immediately.`,
  });
  revalidatePath('/admin/families');
}

export async function saveRestriction(fd: FormData) {
  const { session, tenant } = await ctx();
  if (session.role !== 'ADMIN') return; // restrictions are admin-only
  const householdId = s(fd, 'householdId');
  const name = s(fd, 'restrictedName');
  if (!householdId || !name) return;
  const created = await prisma.pickupRestriction.create({
    data: {
      tenantId: tenant.id,
      householdId,
      studentId: s(fd, 'studentId') || null,
      restrictedName: name,
      sourceNote: s(fd, 'sourceNote') || null,
      staffOnlyDetail: s(fd, 'staffOnlyDetail') || null,
      reviewedBy: session.name,
      reviewedAt: new Date(),
    },
  });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'RESTRICTION_ADDED', entity: 'PickupRestriction', entityId: created.id,
    detail: `Restriction on file for household. Detail withheld from this ledger by design.`,
  });
  revalidatePath('/admin/families');
}

export async function endRestriction(fd: FormData) {
  const { session, tenant } = await ctx();
  if (session.role !== 'ADMIN') return;
  const id = s(fd, 'id');
  await prisma.pickupRestriction.update({ where: { id }, data: { active: false } });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'RESTRICTION_ENDED', entity: 'PickupRestriction', entityId: id,
    detail: 'Restriction ended.',
  });
  revalidatePath('/admin/families');
}

// ---- staff ----

export async function saveStaff(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  const role = ['ADMIN', 'SUPERVISOR', 'TEACHER', 'STAFF'].includes(s(fd, 'role')) ? s(fd, 'role') : 'STAFF';
  const data = {
    name: s(fd, 'name'),
    email: s(fd, 'email').toLowerCase() || null,
    phone: s(fd, 'phone') ? normalizePhone(s(fd, 'phone')) : null,
    role,
  };
  if (!data.name) return;
  let staffId = id;
  if (id) {
    await prisma.staffUser.update({ where: { id }, data });
  } else {
    const created = await prisma.staffUser.create({ data: { ...data, tenantId: tenant.id } });
    staffId = created.id;
    await auditNow({
      tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
      action: 'STAFF_ADDED', entity: 'StaffUser', entityId: created.id,
      detail: `${data.name}, ${role.toLowerCase()}.`,
    });
  }
  // Teacher grade assignment: point the grade's class group at this teacher.
  const grade = s(fd, 'grade');
  if (role === 'TEACHER' && grade && staffId) {
    const groupId = await ensureClassGroup(tenant.id, grade);
    await prisma.classGroup.update({ where: { id: groupId }, data: { teacherId: staffId, room: s(fd, 'room') || undefined } });
  }
  revalidatePath('/admin/staff');
}

// JAB-internal / admin ability: set a temporary password directly, for staff
// who cannot receive the email or text (or at the front desk on day one).
export async function setStaffPassword(fd: FormData) {
  const { session, tenant } = await ctx();
  if (session.role !== 'ADMIN') return;
  const id = s(fd, 'id');
  const pw = String(fd.get('password') || '');
  const { hashPassword, passwordProblem } = await import('@/lib/password');
  if (!id || passwordProblem(pw)) return;
  const st = await prisma.staffUser.update({ where: { id }, data: { passwordHash: hashPassword(pw) } });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'PASSWORD_SET', entity: 'StaffUser', entityId: id,
    detail: `Temporary password set for ${st.name} by ${session.name}.`,
  });
  revalidatePath('/admin/staff');
}

export async function deactivateStaff(fd: FormData) {
  const { tenant } = await ctx();
  void tenant;
  await prisma.staffUser.update({ where: { id: s(fd, 'id') }, data: { active: false } });
  revalidatePath('/admin/staff');
}

// ---- classes ----

export async function saveClassGroup(fd: FormData) {
  const { tenant } = await ctx();
  const id = s(fd, 'id');
  const data = {
    room: s(fd, 'room') || null,
    startTime: s(fd, 'startTime') || null,
    endTime: s(fd, 'endTime') || null,
    season: s(fd, 'season') || null,
    year: parseInt(s(fd, 'year')) || null,
    teacherId: s(fd, 'teacherId') || null,
  };
  if (id) await prisma.classGroup.update({ where: { id }, data });
  void tenant;
  revalidatePath('/admin/classes');
}

// ---- devices ----

export async function createDevice(fd: FormData) {
  const { session, tenant } = await ctx();
  const label = s(fd, 'label');
  if (!label) return;
  const { newToken, sha256 } = await import('@/lib/auth');
  const token = newToken();
  await prisma.device.create({
    data: { tenantId: tenant.id, label, location: s(fd, 'location') || null, tokenHash: sha256(token), kind: 'KIOSK' },
  });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'DEVICE_ADDED', entity: 'Device', detail: `Kiosk "${label}" provisioned.`,
  });
  // The raw token is shown exactly once, via the redirect target.
  const { redirect } = await import('next/navigation');
  redirect(`/admin/devices?minted=${token}`);
}

export async function revokeDevice(fd: FormData) {
  const { session, tenant } = await ctx();
  const id = s(fd, 'id');
  const d = await prisma.device.update({ where: { id }, data: { status: 'revoked' } });
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: session.staffId, actorName: session.name,
    action: 'DEVICE_REVOKED', entity: 'Device', entityId: id, detail: `Kiosk "${d.label}" revoked.`,
  });
  revalidatePath('/admin/devices');
}
