import { NextRequest, NextResponse } from 'next/server';
import { requireSession, AuthError } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { todayInTz, timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSession(['ADMIN', 'SUPERVISOR']);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
    throw err;
  }
  const tenant = await requireTenant();
  const qd = req.nextUrl.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : todayInTz(tenant.timezone);

  const records = await prisma.attendanceRecord.findMany({
    where: { tenantId: tenant.id, date },
    include: { student: true },
    orderBy: [{ student: { grade: 'asc' } }, { student: { lastName: 'asc' } }],
  });

  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['date', 'student', 'grade', 'status', 'check_in', 'check_out', 'released_to', 'released_by', 'late_minutes', 'late_fee', 'reversed'].join(','),
    ...records.map((r) =>
      [
        q(date),
        q(`${r.student.firstName} ${r.student.lastName}`),
        q(r.student.grade),
        q(r.status),
        q(timeLabel(r.checkInAt, tenant.timezone)),
        q(timeLabel(r.checkOutAt, tenant.timezone)),
        q(r.releasedToName || ''),
        q(r.releasedByName || ''),
        r.lateMinutes,
        (r.lateFeeCents / 100).toFixed(2),
        r.reversed ? 'yes' : '',
      ].join(','),
    ),
  ];
  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance-${date}.csv"`,
    },
  });
}
