import { NextRequest, NextResponse } from 'next/server';
import { drainOutbox } from '@/lib/outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cloud Scheduler: every minute during program hours. Drains the transactional
// outbox so a message enqueued during a crashed request still goes out.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await drainOutbox(50);
  return NextResponse.json(result);
}
