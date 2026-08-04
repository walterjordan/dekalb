import { NextResponse } from 'next/server';
import { claimLoginTicket } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Polled by the device that requested a texted sign-in link. Answers pending
// until the phone taps the link; then signs THIS device in (single use).
export async function POST() {
  const result = await claimLoginTicket();
  if (result === 'pending') return NextResponse.json({ pending: true });
  if (!result) return NextResponse.json({ pending: false });
  const dest = result.role === 'TEACHER' ? '/t' : result.role === 'STAFF' ? '/s' : '/admin';
  return NextResponse.json({ dest });
}
