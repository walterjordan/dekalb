import { NextResponse } from 'next/server';

// Staff sign-in STARTED FROM the door kiosk (long-press the header logo).
//
// The cookie does two jobs, which is why it holds a path rather than a flag:
//   1. its presence marks the sign-in as kiosk-originated, so createSession()
//      issues a 30-minute session instead of 14 days on a shared device, and
//   2. its value is where to send the iPad back to when it goes idle.
//
// It is a cookie rather than a query param so that all four sign-in methods
// (password, Google, magic link, temp password) inherit both behaviours without
// each one having to thread state through its own redirect chain.
// Route files may only export route handlers and Next's own config, so the
// cookie name stays a local const rather than a shared export.
const KIOSK_RETURN_COOKIE = 'kiosk_return';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  // Only ever a kiosk path on this origin. Anything else and the cookie would
  // be an open-redirect primitive that survives a login.
  const raw = new URL(req.url).searchParams.get('to') || '';
  const to = /^\/k\/[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;

  // Relative Location on purpose: in a Cloud Run route handler `req.url`
  // resolves to the container bind address, so the absolute form emits
  // https://0.0.0.0:8080/... and mobile Chrome refuses the port.
  const res = new NextResponse(null, { status: 307, headers: { Location: '/login' } });
  if (to) {
    res.cookies.set(KIOSK_RETURN_COOKIE, to, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60, // matches the short session it triggers
      path: '/',
    });
  }
  return res;
}
