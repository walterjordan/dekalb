import { NextRequest, NextResponse } from 'next/server';
import { deviceByToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Polled by the kiosk hold/sent screens. Returns only per-child ladder states -
// no names beyond what the kiosk already showed, and never restriction detail.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const device = await deviceByToken(params.token);
  if (!device) return NextResponse.json({ error: 'Kiosk not available' }, { status: 403 });
  const requestId = req.nextUrl.searchParams.get('r') || '';
  const request = await prisma.pickupRequest.findFirst({
    where: { id: requestId, tenantId: device.tenantId },
    include: { students: { include: { student: { select: { firstName: true } } } } },
  });
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    status: request.status,
    students: request.students.map((i) => ({ name: i.student.firstName, status: i.status })),
  });
}
