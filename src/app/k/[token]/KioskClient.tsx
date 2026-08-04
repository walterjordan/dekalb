'use client';
// The parent-facing kiosk (iPad, fullscreen). Pickup ONLY — arrival is staff
// roll call. Steps: home -> scan|pin|search -> masked confirm -> select
// students + who is picking up -> sent/hold. Auto-resets for the next family.
import { useCallback, useEffect, useRef, useState } from 'react';

interface Masked { householdId: string; masked: string }
interface HouseholdDetail {
  id: string;
  name: string;
  guardians: { id: string; name: string }[];
  authorized: { id: string; name: string }[];
  students: { id: string; name: string; grade: string; room: string | null; eligible: boolean; statusLabel: string }[];
}

type Step =
  | { s: 'home' }
  | { s: 'scan' }
  | { s: 'pin' }
  | { s: 'search' }
  | { s: 'confirm'; matches: Masked[]; picked?: Masked; method: 'PIN' | 'SEARCH' }
  | { s: 'select'; household: HouseholdDetail; method: 'QR' | 'PIN' | 'SEARCH'; guardianId?: string; guardianName?: string }
  | { s: 'sent'; names: string; requestId: string }
  | { s: 'hold'; kind: 'UNAPPROVED_ADULT' | 'RESTRICTION'; requester: string; requestId: string }
  | { s: 'error'; message: string };

const RESET_MS = 45_000;

export default function KioskClient({
  token,
  tenantName,
  deviceLabel,
  presentCount,
}: {
  token: string;
  tenantName: string;
  deviceLabel: string;
  presentCount: number;
}) {
  const [step, setStep] = useState<Step>({ s: 'home' });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState('');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    tick();
    const iv = setInterval(tick, 15_000);
    return () => clearInterval(iv);
  }, []);

  const reset = useCallback(() => {
    setStep({ s: 'home' });
    setQuery('');
    setBusy(false);
  }, []);

  // Idle reset on terminal screens so the next family starts clean.
  useEffect(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (step.s === 'sent' || step.s === 'error') {
      resetTimer.current = setTimeout(reset, RESET_MS);
    }
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [step, reset]);

  const api = useCallback(
    async (path: string, body: unknown) => {
      const res = await fetch(`/api/kiosk/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    },
    [token],
  );

  const doLookup = useCallback(
    async (q: string, method: 'PIN' | 'SEARCH') => {
      setBusy(true);
      try {
        const data = (await api('lookup', { query: q })) as { matches: Masked[] };
        if (!data.matches.length) {
          setStep({ s: 'error', message: 'No matching family found. Please check the code or see the front desk.' });
        } else {
          setStep({ s: 'confirm', matches: data.matches, method });
        }
      } catch (e) {
        setStep({ s: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const openHousehold = useCallback(
    async (householdId: string, method: 'QR' | 'PIN' | 'SEARCH', guardian?: { id: string; name: string }) => {
      setBusy(true);
      try {
        const data = (await api('household', { householdId })) as { household: HouseholdDetail };
        setStep({
          s: 'select',
          household: data.household,
          method,
          guardianId: guardian?.id,
          guardianName: guardian?.name,
        });
      } catch (e) {
        setStep({ s: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const onScan = useCallback(
    async (value: string) => {
      // Parent QR encodes "daa:<parentToken>".
      const m = value.match(/^daa:([A-Za-z0-9_-]{8,})$/);
      if (!m) return;
      setBusy(true);
      try {
        const data = (await api('lookup', { guardianToken: m[1] })) as {
          direct?: { householdId: string; guardianName: string; guardianId: string };
        };
        if (data.direct) {
          await openHousehold(data.direct.householdId, 'QR', {
            id: data.direct.guardianId,
            name: data.direct.guardianName,
          });
        } else {
          setStep({ s: 'error', message: 'That code was not recognized. Try your PIN instead.' });
        }
      } catch {
        setStep({ s: 'error', message: 'That code was not recognized. Try your PIN instead.' });
      } finally {
        setBusy(false);
      }
    },
    [api, openHousehold],
  );

  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center gap-3 border-b border-inkline bg-white px-5 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-maroon font-serif text-[11px] font-bold text-white">
          {tenantName.split(' ').map((w) => w[0]).slice(0, 3).join('')}
        </div>
        <div className="font-serif text-lg font-semibold">{tenantName}</div>
        <div className="ml-auto font-mono text-sm text-neutral-500">{clock}</div>
      </header>

      <div className="flex flex-1 flex-col px-6 py-6">
        {step.s !== 'home' ? (
          <button onClick={reset} className="kiosk-tap mb-3 self-start text-sm text-maroon">
            ← Start over
          </button>
        ) : null}

        {step.s === 'home' && (
          <HomeScreen
            onScan={() => setStep({ s: 'scan' })}
            onPin={() => setStep({ s: 'pin' })}
            onSearch={() => setStep({ s: 'search' })}
          />
        )}

        {step.s === 'scan' && <ScanScreen onResult={onScan} onFallback={() => setStep({ s: 'pin' })} busy={busy} />}

        {(step.s === 'pin' || step.s === 'search') && (
          <div className="mx-auto w-full max-w-md">
            <h1 className="font-serif text-2xl font-semibold">
              {step.s === 'pin' ? 'Enter your family PIN.' : 'Find your family.'}
            </h1>
            <p className="mt-1 text-neutral-500">
              {step.s === 'pin' ? 'The 4-digit code from your welcome letter.' : 'Your last name, or your phone number.'}
            </p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim().length >= 2) doLookup(query.trim(), step.s === 'pin' ? 'PIN' : 'SEARCH');
              }}
              inputMode={step.s === 'pin' ? 'numeric' : 'text'}
              className="mt-5 w-full rounded-xl border-2 border-inkline bg-white px-5 py-4 text-center text-2xl tracking-widest outline-none focus:border-maroon"
              placeholder={step.s === 'pin' ? '••••' : 'Johnson'}
            />
            <button
              disabled={busy || query.trim().length < 2}
              onClick={() => doLookup(query.trim(), step.s === 'pin' ? 'PIN' : 'SEARCH')}
              className="kiosk-tap mt-4 w-full rounded-xl bg-maroon py-4 text-lg font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Looking…' : 'Continue'}
            </button>
          </div>
        )}

        {step.s === 'confirm' && !step.picked && (
          <div className="mx-auto w-full max-w-md">
            <h1 className="font-serif text-2xl font-semibold">
              {step.matches.length === 1 ? 'We found a matching family.' : 'Which family is yours?'}
            </h1>
            <div className="mt-5 grid gap-3">
              {step.matches.map((m) => (
                <button
                  key={m.householdId}
                  onClick={() => setStep({ ...step, picked: m })}
                  className="kiosk-tap rounded-xl border-2 border-inkline bg-sunk px-5 py-4 text-left font-mono text-base hover:border-maroon"
                >
                  {m.masked}
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-neutral-500">Only continue if this looks familiar.</p>
          </div>
        )}

        {step.s === 'confirm' && step.picked && (
          <div className="mx-auto w-full max-w-md">
            <h1 className="font-serif text-2xl font-semibold">We found a matching family.</h1>
            <div className="mt-5 rounded-xl border border-inkline bg-sunk px-5 py-4 font-mono text-base">
              {step.picked.masked}
            </div>
            <p className="mt-3 text-sm text-neutral-500">Only continue if this household information looks familiar.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={reset} className="kiosk-tap flex-1 rounded-xl border-2 border-inkline bg-white py-4 font-semibold">
                Not my family
              </button>
              <button
                disabled={busy}
                onClick={() => openHousehold(step.picked!.householdId, step.method)}
                className="kiosk-tap flex-1 rounded-xl bg-maroon py-4 font-semibold text-white disabled:opacity-40"
              >
                Yes, continue
              </button>
            </div>
          </div>
        )}

        {step.s === 'select' && (
          <SelectScreen
            household={step.household}
            defaultGuardian={step.guardianName}
            busy={busy}
            onSubmit={async (studentIds, requesterName, dismissalMethod) => {
              setBusy(true);
              try {
                const data = (await api('request', {
                  householdId: step.household.id,
                  studentIds,
                  requesterName,
                  requesterGuardianId:
                    step.guardianId && requesterName === step.guardianName ? step.guardianId : undefined,
                  dismissalMethod,
                  method: step.method,
                })) as { requestId: string; status: string; reason?: 'UNAPPROVED_ADULT' | 'RESTRICTION' };
                const names = step.household.students
                  .filter((x) => studentIds.includes(x.id))
                  .map((x) => x.name.split(' ')[0])
                  .join(' and ');
                if (data.status === 'NEEDS_APPROVAL') {
                  setStep({ s: 'hold', kind: data.reason || 'UNAPPROVED_ADULT', requester: requesterName, requestId: data.requestId });
                } else {
                  setStep({ s: 'sent', names, requestId: data.requestId });
                }
              } catch (e) {
                setStep({ s: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {step.s === 'sent' && (
          <div className="mx-auto w-full max-w-md text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good-bg text-3xl text-good">✓</div>
            <h1 className="mt-4 font-serif text-2xl font-semibold">Request sent to the release desk.</h1>
            <p className="mt-2 text-neutral-600">
              {step.names} — we will text you when they are at the door. Please stay in the carline
              or wait by the entrance.
            </p>
            <p className="mt-6 text-sm font-semibold text-maroon">No child has been released yet.</p>
            <button onClick={reset} className="kiosk-tap mt-8 rounded-xl border-2 border-inkline bg-white px-8 py-3 font-semibold">
              Done
            </button>
          </div>
        )}

        {step.s === 'hold' && <HoldScreen token={token} requestId={step.requestId} kind={step.kind} requester={step.requester} onDone={reset} />}

        {step.s === 'error' && (
          <div className="mx-auto w-full max-w-md text-center">
            <h1 className="font-serif text-2xl font-semibold">Hmm.</h1>
            <p className="mt-3 text-neutral-600">{step.message}</p>
            <button onClick={reset} className="kiosk-tap mt-8 rounded-xl bg-maroon px-8 py-3 font-semibold text-white">
              Start over
            </button>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-inkline bg-white px-5 py-2 font-mono text-xs text-neutral-400">
        <span className="h-1.5 w-1.5 rounded-full bg-good" />
        {presentCount} students present · {deviceLabel} online
      </footer>
    </main>
  );
}

function HomeScreen({ onScan, onPin, onSearch }: { onScan: () => void; onPin: () => void; onSearch: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center">
      <h1 className="text-center font-serif text-3xl font-semibold">Scan your code or enter your PIN.</h1>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <button onClick={onScan} className="kiosk-tap rounded-2xl border-2 border-inkline bg-white px-6 py-10 text-center hover:border-maroon">
          <div className="text-4xl text-maroon">▣</div>
          <div className="mt-3 text-xl font-bold">Scan my code</div>
          <div className="mt-1 text-neutral-500">Hold your phone up</div>
        </button>
        <button onClick={onPin} className="kiosk-tap rounded-2xl border-2 border-inkline bg-white px-6 py-10 text-center hover:border-maroon">
          <div className="text-4xl text-maroon">⌘</div>
          <div className="mt-3 text-xl font-bold">Enter my PIN</div>
          <div className="mt-1 text-neutral-500">4-digit family code</div>
        </button>
      </div>
      <button onClick={onSearch} className="kiosk-tap mx-auto mt-6 text-maroon underline-offset-2 hover:underline">
        Don&apos;t have a code? Find my family
      </button>
    </div>
  );
}

function ScanScreen({ onResult, onFallback, busy }: { onResult: (v: string) => void; onFallback: () => void; busy: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const firedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement('canvas');

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const hasNative = 'BarcodeDetector' in window;
        const detector = hasNative
          ? new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] })
          : null;
        const jsqrMod = hasNative ? null : (await import('jsqr')).default;

        const scan = async () => {
          if (cancelled || firedRef.current || !videoRef.current) return;
          const v = videoRef.current;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes.length && !firedRef.current) {
                firedRef.current = true;
                onResult(codes[0].rawValue);
                return;
              }
            } else if (jsqrMod && v.videoWidth) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsqrMod(img.data, img.width, img.height);
                if (code?.data && !firedRef.current) {
                  firedRef.current = true;
                  onResult(code.data);
                  return;
                }
              }
            }
          } catch {
            /* keep scanning */
          }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch {
        setError('Camera is not available on this kiosk. Use your PIN instead.');
      }
    }
    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <h1 className="font-serif text-2xl font-semibold">Hold your code up to the camera.</h1>
      {error ? (
        <p className="mt-4 text-crit">{error}</p>
      ) : (
        <div className="mx-auto mt-5 aspect-square w-full max-w-sm overflow-hidden rounded-2xl border-2 border-inkline bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        </div>
      )}
      <p className="mt-3 text-sm text-neutral-500">{busy ? 'Found it — one moment…' : 'The code is on your parent page.'}</p>
      <button onClick={onFallback} className="kiosk-tap mt-5 rounded-xl border-2 border-inkline bg-white px-6 py-3 font-semibold">
        Enter PIN instead
      </button>
    </div>
  );
}

function SelectScreen({
  household,
  defaultGuardian,
  busy,
  onSubmit,
}: {
  household: HouseholdDetail;
  defaultGuardian?: string;
  busy: boolean;
  onSubmit: (studentIds: string[], requesterName: string, dismissalMethod: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(household.students.filter((s) => s.eligible).map((s) => s.id));
  const knownNames = [...household.guardians.map((g) => g.name), ...household.authorized.map((a) => a.name)];
  const [who, setWho] = useState(defaultGuardian || household.guardians[0]?.name || '');
  const [custom, setCustom] = useState(false);
  const [method, setMethod] = useState('CARLINE');

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="font-serif text-2xl font-semibold">Who are you picking up?</h1>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {household.students.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              disabled={!s.eligible}
              onClick={() => setSelected((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
              className={`kiosk-tap relative rounded-xl border-2 px-4 py-3 text-left ${
                !s.eligible
                  ? 'cursor-not-allowed border-inkline bg-white opacity-40'
                  : on
                    ? 'border-maroon bg-sunk'
                    : 'border-inkline bg-white'
              }`}
            >
              {on && (
                <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-maroon text-xs font-bold text-white">
                  ✓
                </span>
              )}
              <div className="font-semibold">{s.name}</div>
              <div className="font-mono text-xs text-neutral-500">
                Grade {s.grade}
                {s.room ? ` · ${s.room}` : ''}
              </div>
              <div className={`mt-1.5 text-xs font-semibold ${s.eligible ? 'text-good' : 'text-neutral-400'}`}>
                {s.statusLabel}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="text-sm text-neutral-500">Who is picking up?</div>
        {!custom ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {knownNames.map((n) => (
              <button
                key={n}
                onClick={() => setWho(n)}
                className={`kiosk-tap rounded-lg border-2 px-4 py-2 text-sm font-semibold ${
                  who === n ? 'border-maroon bg-maroon text-white' : 'border-inkline bg-white'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => {
                setCustom(true);
                setWho('');
              }}
              className="kiosk-tap rounded-lg border-2 border-dashed border-inkline px-4 py-2 text-sm text-neutral-500"
            >
              Someone else
            </button>
          </div>
        ) : (
          <div className="mt-2">
            <input
              autoFocus
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Their full name"
              className="w-full rounded-lg border-2 border-warn bg-white px-4 py-2.5 outline-none"
            />
            <p className="mt-1 text-xs text-warn">
              If this person is not on the approved list, we will text the parent to confirm before
              any release.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm text-neutral-500">Method</span>
        <div className="flex overflow-hidden rounded-lg border border-inkline">
          {['CARLINE', 'WALKUP', 'BUS'].map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`kiosk-tap px-4 py-2 text-sm ${method === m ? 'bg-maroon font-semibold text-white' : 'bg-white text-neutral-600'}`}
            >
              {m === 'CARLINE' ? 'Carline' : m === 'WALKUP' ? 'Walk-up' : 'Bus'}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={busy || !selected.length || who.trim().length < 2}
        onClick={() => onSubmit(selected, who.trim(), method)}
        className="kiosk-tap mt-6 w-full rounded-xl bg-maroon py-4 text-lg font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Sending…' : 'Request pickup →'}
      </button>
    </div>
  );
}

function HoldScreen({
  token,
  requestId,
  kind,
  requester,
  onDone,
}: {
  token: string;
  requestId: string;
  kind: 'UNAPPROVED_ADULT' | 'RESTRICTION';
  requester: string;
  onDone: () => void;
}) {
  const [state, setState] = useState<'waiting' | 'approved' | 'denied'>('waiting');

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/kiosk/${token}/status?r=${requestId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (['IN_PROGRESS', 'COMPLETED'].includes(data.status)) setState('approved');
        else if (data.status === 'DENIED') setState('denied');
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [token, requestId]);

  // RESTRICTION renders the same neutral copy as any hold — the kiosk never
  // reveals that a restriction exists to the person standing in front of it.
  return (
    <div className="mx-auto w-full max-w-md text-center">
      {state === 'waiting' && (
        <>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-warn-bg text-3xl text-warn">
            {kind === 'RESTRICTION' ? '◆' : '⚠'}
          </div>
          <h1 className="mt-4 font-serif text-2xl font-semibold">
            {kind === 'RESTRICTION' ? 'Please see a staff member at the release desk.' : 'Staff approval needed.'}
          </h1>
          <p className="mt-2 text-neutral-600">
            {kind === 'RESTRICTION'
              ? 'A staff member will be with you shortly.'
              : `"${requester}" is not on the approved pickup list for this family. We texted the parent to confirm. Please see a staff member at the release desk.`}
          </p>
          {kind === 'UNAPPROVED_ADULT' && (
            <p className="mt-5 inline-flex items-center gap-2 font-mono text-sm text-neutral-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-warn" />
              Waiting for parent reply…
            </p>
          )}
        </>
      )}
      {state === 'approved' && (
        <>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good-bg text-3xl text-good">✓</div>
          <h1 className="mt-4 font-serif text-2xl font-semibold">Approved.</h1>
          <p className="mt-2 text-neutral-600">Please see the staff member at the release desk to complete pickup.</p>
        </>
      )}
      {state === 'denied' && (
        <>
          <h1 className="mt-4 font-serif text-2xl font-semibold">Please speak with the front office.</h1>
        </>
      )}
      <button onClick={onDone} className="kiosk-tap mt-8 rounded-xl border-2 border-inkline bg-white px-8 py-3 font-semibold">
        Done
      </button>
    </div>
  );
}
