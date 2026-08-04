'use client';
// Release desk board. Polls every 6s and keeps last-known rows on a failed
// fetch (flaky wifi must degrade to stale, never to blank). The release
// confirm is a full-screen step: the human moment gets a whole screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Row {
  itemId: string;
  requestId: string;
  name: string;
  grade: string;
  room: string;
  requester: string;
  requesterKind: string;
  dismissal: string;
  status: string;
  waitMin: number;
  requestedAt: string;
  restricted: boolean;
  approvalState: string | null;
  approvalNote: string | null;
  parentText: string | null;
}

const TAG: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'REQUESTED', cls: 'bg-warn-bg text-warn' },
  NEEDS_APPROVAL: { label: 'NEEDS APPROVAL', cls: 'bg-crit-bg text-crit' },
  EN_ROUTE: { label: 'EN ROUTE', cls: 'bg-blue-100 text-blue-800' },
  READY: { label: 'READY', cls: 'bg-good-bg text-good' },
  RELEASED: { label: 'RELEASED', cls: 'bg-neutral-800 text-white' },
  DENIED: { label: 'DENIED', cls: 'bg-crit text-white' },
};

export default function BoardClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [present, setPresent] = useState(0);
  const [role, setRole] = useState('STAFF');
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [holdRow, setHoldRow] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/board');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(data.rows);
      setPresent(data.presentCount);
      setRole(data.role);
      setStale(false);
    } catch {
      setStale(true); // keep last-known rows
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 6000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const act = useCallback(
    async (payload: Record<string, string>) => {
      setErr('');
      try {
        const res = await fetch('/api/board/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Action failed');
        await load();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Action failed');
        return false;
      }
    },
    [load],
  );

  const live = rows.filter((r) => !['RELEASED', 'DENIED'].includes(r.status));
  const done = rows.filter((r) => ['RELEASED', 'DENIED'].includes(r.status)).slice(0, 8);
  const shown = filter === 'ALL' ? live : live.filter((r) => r.dismissal === filter);
  const restricted = live.filter((r) => r.restricted);
  const isSupervisor = ['ADMIN', 'SUPERVISOR'].includes(role);

  if (confirm) {
    return (
      <ReleaseConfirm
        row={confirm}
        error={err}
        onCancel={() => {
          setConfirm(null);
          setErr('');
        }}
        onRelease={async () => {
          const ok = await act({ action: 'RELEASED', itemId: confirm.itemId });
          if (ok) setConfirm(null);
        }}
      />
    );
  }

  if (holdRow) {
    return (
      <HoldResolve
        row={holdRow}
        isSupervisor={isSupervisor}
        error={err}
        onCancel={() => {
          setHoldRow(null);
          setErr('');
        }}
        onOverride={async (reason) => {
          const ok = await act({ action: 'OVERRIDE', requestId: holdRow.requestId, reason });
          if (ok) setHoldRow(null);
        }}
        onDeny={async (reason) => {
          const ok = await act({ action: 'DENY', requestId: holdRow.requestId, reason });
          if (ok) setHoldRow(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-5">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="font-serif text-xl font-semibold">Release board</h1>
        <span className="rounded-full bg-warn-bg px-3 py-0.5 font-mono text-xs font-semibold text-warn">
          {live.length} waiting
        </span>
        {stale && (
          <span className="rounded-full bg-crit-bg px-3 py-0.5 font-mono text-xs font-semibold text-crit">
            OFFLINE - showing last known
          </span>
        )}
        <Link href="/" className="ml-auto text-sm text-maroon">
          Home
        </Link>
      </div>

      <div className="mb-3 flex gap-2">
        {['ALL', 'CARLINE', 'WALKUP', 'BUS'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`kiosk-tap rounded-full border px-3.5 py-1 text-xs font-semibold ${
              filter === f ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-inkline bg-white text-neutral-500'
            }`}
          >
            {f === 'ALL' ? 'All' : f === 'CARLINE' ? 'Carline' : f === 'WALKUP' ? 'Walk-up' : 'Bus'}
          </button>
        ))}
      </div>

      {err ? <p className="mb-3 rounded-md bg-crit-bg px-3 py-2 text-sm text-crit">{err}</p> : null}

      {restricted.length > 0 && (
        <div className="mb-3 rounded-lg bg-neutral-900 px-4 py-3 text-white">
          <div className="font-mono text-[11px] tracking-widest">RESTRICTION ON FILE</div>
          {restricted.map((r) => (
            <div key={r.itemId} className="mt-1 text-sm opacity-90">
              {r.name}, Grade {r.grade} - do not release. Take to the front office.
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-inkline bg-white shadow-sm">
        {shown.length === 0 && done.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">No pickups waiting.</p>
        ) : (
          <>
            {shown.map((r) => (
              <BoardRow
                key={r.itemId}
                row={r}
                onAdvance={(to) => act({ action: to, itemId: r.itemId })}
                onRelease={() => setConfirm(r)}
                onOpenHold={() => setHoldRow(r)}
              />
            ))}
            {done.map((r) => (
              <div key={r.itemId} className="flex items-center gap-2 border-b border-inkline px-4 py-2 text-sm text-neutral-400 last:border-b-0">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${TAG[r.status].cls}`}>
                  {TAG[r.status].label}
                </span>
                {r.name} → {r.requester}
              </div>
            ))}
          </>
        )}
      </div>

      <p className="mt-3 font-mono text-xs text-neutral-400">{present} students present</p>
    </main>
  );
}

function BoardRow({
  row,
  onAdvance,
  onRelease,
  onOpenHold,
}: {
  row: Row;
  onAdvance: (to: string) => void;
  onRelease: () => void;
  onOpenHold: () => void;
}) {
  const tag = TAG[row.status] || TAG.REQUESTED;
  return (
    <div
      className={`border-b border-inkline px-4 py-3 last:border-b-0 ${
        row.status === 'NEEDS_APPROVAL' ? 'border-l-4 border-l-crit bg-crit-bg/40' : ''
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{row.name}</span>
        <span className="font-mono text-xs text-neutral-400">Gr {row.grade}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-neutral-400">{row.waitMin}m</span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">
        {row.room ? `${row.room} · ` : ''}
        {row.requester}
        {row.requesterKind === 'UNKNOWN' ? ' (not on list)' : ''} · {row.dismissal.toLowerCase()}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ${tag.cls}`}>{tag.label}</span>
        {row.status === 'REQUESTED' && (
          <button onClick={() => onAdvance('EN_ROUTE')} className="kiosk-tap rounded-md border border-inkline px-3 py-1 text-xs font-semibold">
            Getting ready
          </button>
        )}
        {row.status === 'EN_ROUTE' && (
          <button onClick={() => onAdvance('READY')} className="kiosk-tap rounded-md border border-inkline px-3 py-1 text-xs font-semibold">
            Mark ready
          </button>
        )}
        {row.status === 'READY' && (
          <button onClick={onRelease} className="kiosk-tap rounded-md bg-good px-4 py-1.5 text-xs font-bold text-white">
            RELEASE
          </button>
        )}
        {row.status === 'NEEDS_APPROVAL' && (
          <button onClick={onOpenHold} className="kiosk-tap rounded-md bg-crit px-3 py-1.5 text-xs font-bold text-white">
            {row.restricted ? 'Front office' : 'Open'}
          </button>
        )}
      </div>
      {row.approvalNote && <div className="mt-1.5 text-xs text-good">{row.approvalNote}</div>}
      {row.parentText === 'FAILED' && (
        <div className="mt-1.5 text-xs font-semibold text-crit">Parent text NOT delivered - call the guardian.</div>
      )}
      {row.restricted && (
        <div className="mt-1.5 text-xs font-semibold text-crit">Restriction on file. Reason withheld from floor staff by design.</div>
      )}
    </div>
  );
}

function ReleaseConfirm({
  row,
  error,
  onCancel,
  onRelease,
}: {
  row: Row;
  error: string;
  onCancel: () => void;
  onRelease: () => void;
}) {
  const unusual = row.requesterKind !== 'GUARDIAN' || !!row.approvalNote;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-serif text-2xl font-semibold">Confirm release</h1>
      <p className="mt-1 text-sm text-neutral-500">Releasing to the adult in front of you</p>
      <div className="mt-5 grid gap-3 rounded-xl border border-inkline bg-sunk p-4">
        <Field k="Student" v={`${row.name}, Grade ${row.grade}`} />
        <Field k="Adult" v={row.requester} />
        <Field
          k="Status"
          v={row.requesterKind === 'GUARDIAN' ? 'Guardian on file' : row.approvalNote || 'Approved adult'}
        />
        <Field k="Requested" v={`${row.requestedAt} · ${row.dismissal.toLowerCase()}`} />
      </div>
      {unusual && (
        <p className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">
          Not a regular pickup. Check photo ID before releasing.
        </p>
      )}
      {error ? <p className="mt-3 rounded-md bg-crit-bg px-3 py-2 text-sm text-crit">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button onClick={onCancel} className="kiosk-tap flex-1 rounded-xl border-2 border-inkline bg-white py-3.5 font-semibold">
          Back
        </button>
        <button onClick={onRelease} className="kiosk-tap flex-1 rounded-xl bg-good py-3.5 font-bold text-white">
          RELEASE
        </button>
      </div>
    </main>
  );
}

function HoldResolve({
  row,
  isSupervisor,
  error,
  onCancel,
  onOverride,
  onDeny,
}: {
  row: Row;
  isSupervisor: boolean;
  error: string;
  onCancel: () => void;
  onOverride: (reason: string) => void;
  onDeny: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-serif text-2xl font-semibold">{row.restricted ? 'Front office' : 'Held pickup'}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {row.restricted ? 'Restriction on file - front office only' : 'Adult not on the approved list'}
      </p>
      <div className="mt-5 grid gap-3 rounded-xl border border-inkline bg-sunk p-4">
        <Field k="Student" v={`${row.name}, Grade ${row.grade}`} />
        <Field k="Adult" v={row.requester} />
        <Field k="Requested" v={`${row.requestedAt} · via kiosk`} />
        {!row.restricted && <Field k="Parent" v={row.approvalState === 'PENDING' ? 'Asked to confirm by text' : row.approvalNote || '-'} />}
      </div>
      {row.restricted ? (
        <p className="mt-3 rounded-md bg-crit-bg px-3 py-2 text-sm text-crit">
          Do not release. {isSupervisor ? 'Overriding a restriction requires a written reason and is recorded permanently.' : 'Only a supervisor can resolve this.'}
        </p>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">
          The parent was texted an approval link. If they approve, this clears on its own.{' '}
          {isSupervisor ? 'An override requires a written reason.' : ''}
        </p>
      )}
      {isSupervisor && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required for override or deny)"
          rows={2}
          className="mt-4 w-full rounded-lg border border-inkline px-3 py-2 text-sm outline-none focus:border-maroon"
        />
      )}
      {error ? <p className="mt-3 rounded-md bg-crit-bg px-3 py-2 text-sm text-crit">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button onClick={onCancel} className="kiosk-tap flex-1 rounded-xl border-2 border-inkline bg-white py-3 font-semibold">
          Back
        </button>
        {isSupervisor && (
          <>
            <button onClick={() => onDeny(reason)} className="kiosk-tap flex-1 rounded-xl bg-crit py-3 font-bold text-white">
              Deny release
            </button>
            <button
              onClick={() => onOverride(reason)}
              className="kiosk-tap flex-1 rounded-xl border-2 border-warn bg-white py-3 font-semibold text-warn"
            >
              Override
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-24 flex-none font-mono text-[10px] uppercase tracking-widest text-neutral-400">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}
