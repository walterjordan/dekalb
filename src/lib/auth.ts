// Staff auth: stateless magic links + a signed session cookie, same pattern as
// jab-ops client-magic-link.ts / client-auth.ts. Device tokens are opaque
// random values whose sha256 lives on the Device row.
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import type { StaffUser, Device } from '@prisma/client';

const COOKIE = 'dismissal_session';

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  // Do NOT trim — see the jab-ops SESSION_SECRET trailing-CR incident. Use the
  // raw value byte-for-byte so a secret with trailing whitespace still verifies
  // consistently everywhere it is read.
  return new TextEncoder().encode(s);
}

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function newToken(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

export interface StaffSession {
  staffId: string;
  tenantId: string;
  name: string;
  role: string;
}

// ---- magic link (login) ----

export async function mintLoginLink(staff: StaffUser, baseUrl: string): Promise<string> {
  const jwt = await new SignJWT({ purpose: 'staff_signin', staffId: staff.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(secret());
  return `${baseUrl.replace(/\/+$/, '')}/login/magic?token=${jwt}`;
}

export async function consumeLoginToken(token: string): Promise<StaffUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== 'staff_signin' || typeof payload.staffId !== 'string') return null;
    const staff = await prisma.staffUser.findUnique({ where: { id: payload.staffId } });
    return staff && staff.active ? staff : null;
  } catch {
    return null;
  }
}

// ---- session cookie ----

export async function createSession(staff: StaffUser): Promise<void> {
  const jwt = await new SignJWT({
    purpose: 'staff_session',
    staffId: staff.id,
    tenantId: staff.tenantId,
    name: staff.name,
    role: staff.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('14d')
    .sign(secret());
  cookies().set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 14 * 24 * 3600,
    path: '/',
  });
}

export async function getSession(): Promise<StaffSession | null> {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret());
    if (payload.purpose !== 'staff_session') return null;
    return {
      staffId: String(payload.staffId),
      tenantId: String(payload.tenantId),
      name: String(payload.name),
      role: String(payload.role),
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  cookies().delete(COOKIE);
}

export async function requireSession(roles?: string[]): Promise<StaffSession> {
  const s = await getSession();
  if (!s) throw new AuthError('Sign in required');
  if (roles && !roles.includes(s.role)) throw new AuthError('Not allowed for your role');
  return s;
}

export class AuthError extends Error {}

// ---- devices ----

export async function deviceByToken(token: string): Promise<Device | null> {
  if (!token) return null;
  const d = await prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
  if (!d || d.status !== 'active') return null;
  // Heartbeat — this is what feeds uptime monitoring.
  prisma.device
    .update({ where: { id: d.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return d;
}
