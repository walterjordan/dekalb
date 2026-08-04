// Plain-text email via the Gmail API, using the JAB domain-wide-delegation
// service account (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY) impersonating
// EMAIL_FROM. Built on jose + fetch - no googleapis dependency.
import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export function emailConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

async function accessToken(subject: string): Promise<string> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL!;
  const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const key = await importPKCS8(rawKey, 'RS256');
  const assertion = await new SignJWT({ scope: SCOPE, sub: subject })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token exchange failed: ${data.error_description || res.status}`);
  }
  return data.access_token;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
}): Promise<boolean> {
  if (!emailConfigured()) return false;
  const from = process.env.EMAIL_FROM || 'walterjordan@jordanborden.com';
  try {
    const token = await accessToken(from);
    const raw = [
      `From: ${args.fromName ? `"${args.fromName}" ` : ''}<${from}>`,
      `To: ${args.to}`,
      `Subject: ${args.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      args.text,
    ].join('\r\n');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
    });
    if (!res.ok) {
      console.error('gmail send failed', res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('gmail send error', err instanceof Error ? err.message : err);
    return false;
  }
}
