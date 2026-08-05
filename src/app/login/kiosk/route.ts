import { NextResponse } from 'next/server';

// Staff sign-in STARTED FROM the door kiosk. This exists so the shorter
// session applies no matter which of the four sign-in methods they then use:
// the marker is a cookie rather than a query param threaded through password,
// Google, magic-link and temp-password paths separately.
//
// createSession() consumes and clears it. 10 minutes is the window to finish
// signing in, not the session length.
//
// The Location header is RELATIVE on purpose. In a Cloud Run route handler
// `req.url` resolves to the container's bind address, so NextResponse.redirect
// (which needs an absolute URL) emits https://0.0.0.0:8080/login and mobile
// Chrome refuses it as a restricted port. Middleware redirects are unaffected;
// route handlers are not.
export const dynamic = 'force-dynamic';

export function GET() {
  const res = new NextResponse(null, { status: 307, headers: { Location: '/login' } });
  res.cookies.set('kiosk_origin', '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return res;
}
