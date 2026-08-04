import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JAB Dismissal',
  description: 'Student check-in and pickup',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1, // kiosk: no pinch-zoom surprises mid-dismissal
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-neutral-900">{children}</body>
    </html>
  );
}
