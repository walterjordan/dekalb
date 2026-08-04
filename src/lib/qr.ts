// QR generation, same shape as jab-ops src/lib/qr.ts. Errors are swallowed:
// a missing QR renders as its PIN fallback, never a crash.
import QRCode from 'qrcode';

export async function qrDataUrl(
  text: string,
  colors?: { dark?: string; light?: string },
): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      margin: 1,
      width: 320,
      color: { dark: colors?.dark || '#1B1618', light: colors?.light || '#FFFFFF' },
    });
  } catch {
    return '';
  }
}

export async function qrPngBuffer(text: string, width = 480): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(text, { margin: 1, width });
  } catch {
    return null;
  }
}
