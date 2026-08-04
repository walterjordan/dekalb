// E.164 normalization, US default. Mirrors jab-ops src/lib/sms.ts normalizePhone.
export function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

export function lastFour(phone: string | null | undefined): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.slice(-4);
}
