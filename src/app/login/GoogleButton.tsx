'use client';
// "Sign in with Google" via Google Identity Services. The client ID arrives as
// a server-passed prop (NOT a NEXT_PUBLIC_ var - those bake at build time on
// this stack and silently go stale). The ID token posts to /api/auth/google,
// which verifies it server-side and only signs in emails already on the staff
// list - no self-signup.
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function GoogleButton({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: resp.credential }),
          });
          const data = await res.json().catch(() => ({}));
          window.location.href = res.ok ? data.dest || '/' : '/login?google=unknown';
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
      });
    };
    document.head.appendChild(s);
    return () => {
      s.remove();
    };
  }, [clientId]);

  return (
    <div className="rounded-xl border border-inkline bg-white p-5 shadow-sm">
      <div ref={ref} className="flex justify-center" />
      <p className="mt-2 text-center text-xs text-neutral-400">
        Works for staff whose work email is a Google account.
      </p>
    </div>
  );
}
