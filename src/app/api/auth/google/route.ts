import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { createSession } from '@/lib/auth';
import { auditNow } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Google sign-in: the GSI button posts an ID token; we verify it against
// Google's tokeninfo endpoint (aud + email_verified) and sign in ONLY emails
// already on the active staff list. No self-signup path exists.
export async function POST(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Google sign-in is not configured' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { credential?: string };
  if (!body.credential) return NextResponse.json({ error: 'Missing credential' }, { status: 400 });

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`,
  );
  if (!res.ok) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
  const info = (await res.json()) as {
    aud?: string;
    email?: string;
    email_verified?: string;
    sub?: string;
    exp?: string;
  };
  if (info.aud !== clientId || info.email_verified !== 'true' || !info.email) {
    return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
  }

  const tenant = await requireTenant();
  const staff = await prisma.staffUser.findFirst({
    where: { tenantId: tenant.id, email: { equals: info.email, mode: 'insensitive' }, active: true },
  });
  if (!staff) return NextResponse.json({ error: 'Not on the staff list' }, { status: 403 });

  if (info.sub && staff.googleSub !== info.sub) {
    await prisma.staffUser.update({
      where: { id: staff.id },
      data: { googleSub: info.sub, emailVerifiedAt: staff.emailVerifiedAt || new Date() },
    });
  }
  await createSession(staff);
  await auditNow({
    tenantId: tenant.id, actorKind: 'STAFF', actorId: staff.id, actorName: staff.name,
    action: 'SIGNED_IN', entity: 'StaffUser', entityId: staff.id, detail: `${staff.name} signed in with Google.`,
  });
  const dest = staff.role === 'TEACHER' ? '/t' : staff.role === 'STAFF' ? '/s' : '/admin';
  return NextResponse.json({ dest });
}
