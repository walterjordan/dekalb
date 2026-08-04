import { NextResponse } from 'next/server';
import { requireSession, AuthError } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { todayInTz, timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

// The release board feed. Restriction DETAIL never leaves this endpoint —
// floor staff get a boolean and a routing instruction only.
export async function GET() {
  try {
    const session = await requireSession();
    const tenant = await requireTenant();
    const date = todayInTz(tenant.timezone);

    const items = await prisma.pickupRequestStudent.findMany({
      where: {
        request: { tenantId: tenant.id, date },
        status: { in: ['REQUESTED', 'NEEDS_APPROVAL', 'EN_ROUTE', 'READY', 'RELEASED', 'DENIED'] },
      },
      include: {
        student: { include: { classGroup: true, restrictions: { where: { active: true }, select: { id: true } } } },
        request: { include: { approvals: true } },
      },
      orderBy: { request: { requestedAt: 'desc' } },
      take: 60,
    });

    const outbox = await prisma.messageOutbox.findMany({
      where: {
        tenantId: tenant.id,
        kind: 'PICKUP_READY',
        refId: { in: items.map((i) => i.id) },
      },
      select: { refId: true, status: true },
    });
    const msgByItem = new Map(outbox.map((m) => [m.refId, m.status]));

    const now = Date.now();
    const rows = items.map((i) => {
      const approval = i.request.approvals[0];
      return {
        itemId: i.id,
        requestId: i.requestId,
        name: `${i.student.firstName} ${i.student.lastName}`,
        grade: i.student.grade,
        room: i.student.classGroup?.room || '',
        requester: i.request.requesterName,
        requesterKind: i.request.requesterKind,
        dismissal: i.request.dismissalMethod,
        status: i.status,
        waitMin: Math.floor((now - i.request.requestedAt.getTime()) / 60_000),
        requestedAt: timeLabel(i.request.requestedAt, tenant.timezone),
        restricted: i.student.restrictions.length > 0 && i.status === 'NEEDS_APPROVAL',
        approvalState: approval?.status || null,
        approvalNote:
          approval?.status === 'APPROVED_ONCE'
            ? `Parent approved, today only`
            : approval?.status === 'APPROVED_ALWAYS'
              ? 'Parent approved, permanent'
              : approval?.status === 'OVERRIDDEN'
                ? `Override by ${approval.overrideByName}`
                : null,
        parentText: msgByItem.get(i.id) || null, // SENT | DELIVERED | FAILED | QUEUED
      };
    });

    const presentCount = await prisma.attendanceRecord.count({
      where: { tenantId: tenant.id, date, status: 'CHECKED_IN' },
    });

    return NextResponse.json({ rows, presentCount, role: session.role });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
    throw err;
  }
}
