import { NextRequest, NextResponse } from 'next/server';
import { consumeLoginToken, createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Redirects are RELATIVE on purpose: on Cloud Run, req.nextUrl.origin resolves
// to the container bind address (https://0.0.0.0:8080), which sent users to a
// dead host - the exact participant-link incident pattern from 2026-06-02. A
// relative Location works on whichever domain the user arrived on.
function relativeRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const staff = await consumeLoginToken(token);
  if (!staff) {
    return relativeRedirect('/login?expired=1');
  }
  await createSession(staff);
  const dest = staff.role === 'TEACHER' ? '/t' : staff.role === 'STAFF' ? '/s' : '/admin';
  return relativeRedirect(dest);
}
