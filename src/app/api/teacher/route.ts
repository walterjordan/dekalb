import { NextResponse } from 'next/server';
import { requireSession, AuthError } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { todayInTz, timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

// The teacher's room feed: pickup alerts for their grade + who is in the room.
export async function GET() {
  try {
    const session = await requireSession();
    const tenant = await requireTenant();
    const date = todayInTz(tenant.timezone);

    const groups = await prisma.classGroup.findMany({
      where: { tenantId: tenant.id, teacherId: session.staffId, active: true },
      include: { students: { where: { active: true }, select: { id: true } } },
    });
    const studentIds = groups.flatMap((g) => g.students.map((s) => s.id));

    const alerts = await prisma.pickupRequestStudent.findMany({
      where: {
        studentId: { in: studentIds },
        status: { in: ['REQUESTED', 'EN_ROUTE'] },
        request: { date },
      },
      include: { student: true, request: true },
      orderBy: { request: { requestedAt: 'asc' } },
    });

    const inRoom = await prisma.attendanceRecord.findMany({
      where: { tenantId: tenant.id, date, status: 'CHECKED_IN', studentId: { in: studentIds } },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { student: { firstName: 'asc' } },
    });

    return NextResponse.json({
      groups: groups.map((g) => ({ grade: g.grade, room: g.room, name: g.name })),
      alerts: alerts.map((a) => ({
        itemId: a.id,
        student: `${a.student.firstName} ${a.student.lastName}`,
        requester: a.request.requesterName,
        dismissal: a.request.dismissalMethod,
        at: timeLabel(a.request.requestedAt, tenant.timezone),
        status: a.status,
      })),
      inRoom: inRoom.map((r) => `${r.student.firstName} ${r.student.lastName[0]}.`),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
    throw err;
  }
}
