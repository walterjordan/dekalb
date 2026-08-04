'use client';
// After "text me a link", THIS device polls its login ticket. The moment the
// link is tapped on the phone, the poll answers with a destination and this
// device is signed in - no retyping anything on the computer.
import { useEffect, useState } from 'react';

export default function WaitForApproval() {
  const [state, setState] = useState<'waiting' | 'done' | 'gone'>('waiting');

  useEffect(() => {
    let stop = false;
    const iv = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/ticket', { method: 'POST' });
        if (stop) return;
        const data = (await res.json().catch(() => ({}))) as { dest?: string; pending?: boolean };
        if (data.dest) {
          setState('done');
          window.location.href = data.dest;
        } else if (!data.pending) {
          setState('gone');
          clearInterval(iv);
        }
      } catch {
        /* transient - keep polling */
      }
    }, 2500);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  if (state === 'done') return <p className="mb-4 text-center text-sm font-semibold text-good">Signed in - opening your dashboard…</p>;
  if (state === 'gone')
    return (
      <p className="mb-4 text-center text-sm text-neutral-400">
        This waiting session ended. Request a new link, or sign in with your password.
      </p>
    );
  return (
    <p className="mb-4 flex items-center justify-center gap-2 font-mono text-xs text-neutral-400">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-warn" />
      Waiting for you to tap the link on your phone…
    </p>
  );
}
