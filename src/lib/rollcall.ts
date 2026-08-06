// Roll call: staff check students IN. Students walk over from the school day,
// so arrival is a register worked by an admin or teacher, not a kiosk queue.
// "Not marked" is the absence of a row; ABSENT is a deliberate state.
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { attendanceLabel } from '@/lib/labels';
import { todayInTz } from '@/lib/dates';
import type { Tenant } from '@prisma/client';
import type { StaffActor } from '@/lib/pickup';

export const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

export interface RollRow {
  studentId: string;
  name: string;
  state: 'NOT_MARKED' | 'CHECKED_IN' | 'ABSENT' | 'RELEASED';
  at: Date | null;
  attendanceId: string | null;
}

export async function gradeRoll(tenant: Tenant, grade: string) {
  const date = todayInTz(tenant.timezone);
  const students = await prisma.student.findMany({
    where: { tenantId: tenant.id, grade, active: true },
    include: { attendance: { where: { date } }, classGroup: { include: { teacher: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  const rows: RollRow[] = students.map((s) => {
    const a = s.attendance[0];
    return {
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      state: !a
        ? 'NOT_MARKED'
        : a.status === 'ABSENT'
          ? 'ABSENT'
          : a.status === 'CHECKED_IN'
            ? 'CHECKED_IN'
            : 'RELEASED',
      at: a?.checkInAt || null,
      attendanceId: a?.id || null,
    };
  });
  const group = students[0]?.classGroup;
  return {
    date,
    grade,
    room: group?.room || null,
    teacher: group?.teacher?.name || null,
    rows,
    counts: {
      total: rows.length,
      in: rows.filter((r) => r.state === 'CHECKED_IN' || r.state === 'RELEASED').length,
      absent: rows.filter((r) => r.state === 'ABSENT').length,
    },
  };
}

export async function markStudent(
  tenant: Tenant,
  studentId: string,
  mark: 'CHECK_IN' | 'UNDO' | 'ABSENT',
  actor: StaffActor,
): Promise<void> {
  const date = todayInTz(tenant.timezone);
  await prisma.$transaction(async (tx) => {
    const student = await tx.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
    });
    if (!student) throw new Error('Student not found');
    const existing = await tx.attendanceRecord.findUnique({
      where: { studentId_date: { studentId, date } },
    });
    const name = `${student.firstName} ${student.lastName}`;

    if (mark === 'CHECK_IN') {
      if (existing && existing.status !== 'ABSENT') return; // already in - idempotent
      if (existing) {
        await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: { status: 'CHECKED_IN', checkInAt: new Date(), checkInById: actor.staffId, checkInByName: actor.name },
        });
      } else {
        await tx.attendanceRecord.create({
          data: {
            tenantId: tenant.id,
            studentId,
            date,
            status: 'CHECKED_IN',
            checkInAt: new Date(),
            checkInById: actor.staffId,
            checkInByName: actor.name,
          },
        });
      }
      await audit(tx, {
        tenantId: tenant.id, actorKind: 'STAFF', actorId: actor.staffId, actorName: actor.name,
        action: 'CHECK_IN', entity: 'Student', entityId: studentId,
        detail: `${name} was checked in during grade ${student.grade} roll call.`,
      });
    } else if (mark === 'ABSENT') {
      if (existing && (existing.status === 'RELEASED' || existing.status === 'RELEASED_LATE')) {
        throw new Error('Already released today');
      }
      if (existing) {
        await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: 'ABSENT', checkInAt: null } });
      } else {
        await tx.attendanceRecord.create({
          data: { tenantId: tenant.id, studentId, date, status: 'ABSENT' },
        });
      }
      await audit(tx, {
        tenantId: tenant.id, actorKind: 'STAFF', actorId: actor.staffId, actorName: actor.name,
        action: 'ABSENT', entity: 'Student', entityId: studentId,
        detail: `${name} marked absent.`,
      });
    } else {
      // UNDO - only while nothing downstream depends on the row.
      if (!existing) return;
      if (existing.status === 'RELEASED' || existing.status === 'RELEASED_LATE') {
        throw new Error('Cannot undo after release');
      }
      const openItem = await tx.pickupRequestStudent.findFirst({
        where: { studentId, status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY'] } },
      });
      if (openItem) throw new Error('A pickup is in progress for this student');
      await tx.attendanceRecord.delete({ where: { id: existing.id } });
      await audit(tx, {
        tenantId: tenant.id, actorKind: 'STAFF', actorId: actor.staffId, actorName: actor.name,
        action: 'CHECK_IN_UNDONE', entity: 'Student', entityId: studentId,
        detail: `The roll call mark for ${name} was undone. They had been marked ${attendanceLabel(existing.status).toLowerCase()}.`,
      });
    }
  });
}
