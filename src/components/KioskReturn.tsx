'use client';
// Sends an unattended door iPad back to being a kiosk.
//
// The failure this exists for: staff taps into the admin side, gets pulled away
// by a parent, and the front-door iPad is left showing a login form or, worse,
// the student roster, while people are trying to collect children. The iPad's
// resting state has to be the kiosk no matter what happened before.
//
// Two behaviours, because the stakes differ:
//   signed out -> return silently. There is nothing to lose and no reason to ask.
//   signed in  -> ask first, because a person may genuinely be mid-task. The
//                 countdown EXPIRES TO LEAVE, never to stay: an unanswered
//                 prompt is itself the evidence that nobody is standing there.
//
// The overlay is opaque on purpose. The moment it fires is exactly when the
// screen is probably unattended with student records on it, so covering the
// page for the countdown removes that exposure rather than framing it.
import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export default function KioskReturn({
  returnTo,
  signedIn,
  idleSeconds,
  graceSeconds = 10,
}: {
  returnTo: string;
  signedIn: boolean;
  idleSeconds: number;
  graceSeconds?: number;
}) {
  const [prompting, setPrompting] = useState(false);
  const [left, setLeft] = useState(graceSeconds);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptingRef = useRef(false);

  const go = useCallback(() => {
    window.location.href = returnTo;
  }, [returnTo]);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (!signedIn) {
        go();
        return;
      }
      promptingRef.current = true;
      setLeft(graceSeconds);
      setPrompting(true);
    }, idleSeconds * 1000);
  }, [go, graceSeconds, idleSeconds, signedIn]);

  // Any real interaction resets the clock. While the prompt is up we stop
  // listening, so a stray tap cannot silently answer it.
  useEffect(() => {
    const onActivity = () => {
      if (promptingRef.current) return;
      armIdle();
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    armIdle();
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [armIdle]);

  // Countdown. Reaching zero leaves, which is the safe answer.
  useEffect(() => {
    if (!prompting) return;
    const iv = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          clearInterval(iv);
          go();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [prompting, go]);

  const stay = useCallback(() => {
    promptingRef.current = false;
    setPrompting(false);
    armIdle();
  }, [armIdle]);

  // Escape is the safe answer, not the dismissive one.
  useEffect(() => {
    if (!prompting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompting, go]);

  if (!prompting) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="kiosk-return-title"
      className="fixed inset-0 z-50 grid place-items-center bg-paper px-6"
    >
      <div className="w-full max-w-md text-center">
        <h2 id="kiosk-return-title" className="font-serif text-3xl font-semibold">
          Need to stay signed in?
        </h2>
        <p className="mt-3 text-neutral-600">
          This iPad goes back to the pickup screen in{' '}
          <span className="font-mono font-bold tabular-nums text-maroon">{left}</span>{' '}
          {left === 1 ? 'second' : 'seconds'}.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            autoFocus
            onClick={stay}
            className="kiosk-tap rounded-xl bg-maroon px-6 py-4 text-lg font-semibold text-white"
          >
            Yes, keep working
          </button>
          <button
            onClick={go}
            className="kiosk-tap rounded-xl border-2 border-inkline bg-white px-6 py-4 text-lg font-semibold"
          >
            No, back to pickup
          </button>
        </div>
      </div>
    </div>
  );
}
