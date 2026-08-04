import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public prefixes: token-authed surfaces carry their own opaque credential in
// the URL (same pattern as jab-ops /kiosk). Everything else needs the staff
// session cookie and bounces to /login.
const PUBLIC_PREFIXES = [
  '/k', // kiosk (device token)
  '/p', // parent page (guardian token)
  '/approve', // single-use approval links
  '/a', // published announcements
  '/login',
  '/api/auth', // sign-in endpoints: ticket polling + Google credential check
  '/api/kiosk',
  '/api/parent',
  '/api/approve',
  '/api/health',
  '/api/cron',
  '/_next',
  '/favicon.ico',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const hasSession = req.cookies.has('dismissal_session');
  if (!hasSession && pathname !== '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
