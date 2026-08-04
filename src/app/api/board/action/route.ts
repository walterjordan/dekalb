import { NextRequest, NextResponse } from 'next/server';
import { requireSession, AuthError } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { advanceItem, overrideHold, denyRequest, PickupError } from '@/lib/pickup';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const tenant = await requireTenant();
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      itemId?: string;
      requestId?: string;
      reason?: string;
    };
    const actor = { staffId: session.staffId, name: session.name, role: session.role };

    switch (body.action) {
      case 'EN_ROUTE':
      case 'READY':
      case 'RELEASED':
      case 'CANCELLED':
        await advanceItem(tenant, String(body.itemId || ''), body.action, actor);
        break;
      case 'OVERRIDE':
        await overrideHold(tenant, String(body.requestId || ''), actor, String(body.reason || ''));
        break;
      case 'DENY':
        await denyRequest(tenant, String(body.requestId || ''), actor, String(body.reason || ''));
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
    if (err instanceof PickupError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('board action failed', err);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
