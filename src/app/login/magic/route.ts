import { NextRequest, NextResponse } from 'next/server';
import { consumeLoginToken, createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const staff = await consumeLoginToken(token);
  const base = req.nextUrl.origin;
  if (!staff) {
    return NextResponse.redirect(`${base}/login?sent=0`);
  }
  await createSession(staff);
  const dest = staff.role === 'TEACHER' ? '/t' : staff.role === 'STAFF' ? '/s' : '/admin';
  return NextResponse.redirect(`${base}${dest}`);
}
