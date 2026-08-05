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
  // Do NOT trim - see the jab-ops SESSION_SECRET trailing-CR incident. Use the
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

// ---- magic link (login), with cross-device ticket approval ----
// The device that ASKS for the link (often a computer or the front-desk iPad)
// creates a LoginTicket and polls it. The texted link carries the ticket id;
// tapping it on the phone signs the phone in AND approves the ticket, so the
// asking device continues right where it was.

const TICKET_COOKIE = 'dismissal_ticket';
export const TICKET_TTL_MS = 10 * 60_000;

export async function createLoginTicket(tenantId: string, staffId: string | null): Promise<string> {
  const ticketSecret = newToken();
  const ticket = await prisma.loginTicket.create({
    data: {
      tenantId,
      staffId,
      secretHash: sha256(ticketSecret),
      expiresAt: new Date(Date.now() + TICKET_TTL_MS),
    },
  });
  cookies().set(TICKET_COOKIE, `${ticket.id}.${ticketSecret}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TICKET_TTL_MS / 1000,
    path: '/',
  });
  return ticket.id;
}

/** If this device's ticket is approved, sign the device in. Single use. */
export async function claimLoginTicket(): Promise<StaffUser | 'pending' | null> {
  const raw = cookies().get(TICKET_COOKIE)?.value || '';
  const [id, ticketSecret] = raw.split('.');
  if (!id || !ticketSecret) return null;
  const ticket = await prisma.loginTicket.findUnique({ where: { id } });
  if (!ticket || ticket.secretHash !== sha256(ticketSecret)) return null;
  if (ticket.expiresAt < new Date() || ticket.status === 'USED' || ticket.status === 'EXPIRED') return null;
  if (ticket.status === 'PENDING') return 'pending';
  // APPROVED - claim it exactly once.
  const claimed = await prisma.loginTicket.updateMany({
    where: { id, status: 'APPROVED' },
    data: { status: 'USED' },
  });
  if (!claimed.count || !ticket.staffId) return null;
  const staff = await prisma.staffUser.findUnique({ where: { id: ticket.staffId } });
  if (!staff || !staff.active) return null;
  await createSession(staff);
  cookies().delete(TICKET_COOKIE);
  return staff;
}

export async function mintLoginLink(staff: StaffUser, baseUrl: string, ticketId?: string): Promise<string> {
  const jwt = await new SignJWT({ purpose: 'staff_signin', staffId: staff.id, ticketId: ticketId || null })
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
    if (!staff || !staff.active) return null;
    // Approve the waiting device's ticket, if the link carried one.
    if (typeof payload.ticketId === 'string' && payload.ticketId) {
      await prisma.loginTicket.updateMany({
        where: { id: payload.ticketId, status: 'PENDING', expiresAt: { gt: new Date() }, staffId: staff.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
    }
    return staff;
  } catch {
    return null;
  }
}

// ---- password set / reset links (emailed; consuming one proves the mailbox) ----

export async function mintPasswordResetToken(staff: StaffUser): Promise<string> {
  return new SignJWT({ purpose: 'staff_pw_reset', staffId: staff.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60m')
    .sign(secret());
}

export async function consumePasswordResetToken(token: string): Promise<StaffUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== 'staff_pw_reset' || typeof payload.staffId !== 'string') return null;
    const staff = await prisma.staffUser.findUnique({ where: { id: payload.staffId } });
    return staff && staff.active ? staff : null;
  } catch {
    return null;
  }
}

// ---- session cookie ----

// A staff sign-in started FROM the door kiosk gets a short session. That iPad
// sits unattended in a hallway, so a 14-day cookie there means the next person
// to pick it up has the roster. 30 minutes is long enough to check something
// and short enough that forgetting to sign out is self-healing.
const KIOSK_SESSION_SECONDS = 30 * 60;
const NORMAL_SESSION_SECONDS = 14 * 24 * 3600;

export async function createSession(staff: StaffUser, opts?: { shortLived?: boolean }): Promise<void> {
  // /login/kiosk drops this marker, so every sign-in method (password, Google,
  // magic link, temp password) inherits the short session without each one
  // having to know where the sign-in started. It is NOT cleared here: the same
  // cookie tells the admin pages where to send this iPad back to when it goes
  // idle, so it lives as long as the session it shortened.
  const fromKiosk = Boolean(cookies().get('kiosk_return')?.value);
  const seconds = opts?.shortLived || fromKiosk ? KIOSK_SESSION_SECONDS : NORMAL_SESSION_SECONDS;
  const jwt = await new SignJWT({
    purpose: 'staff_session',
    staffId: staff.id,
    tenantId: staff.tenantId,
    name: staff.name,
    role: staff.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(secret());
  cookies().set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: seconds,
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
  // Heartbeat - this is what feeds uptime monitoring.
  prisma.device
    .update({ where: { id: d.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return d;
}
