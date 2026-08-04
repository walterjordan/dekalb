'use client';
// The walkie-talkie replacement. A pickup for this teacher's grade lights up
// here (they also get a text). One tap - "Sending them now" - moves the child
// to EN ROUTE on the release desk board, so the desk gets an answer instead of
// asking again over the radio.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Alert {
  itemId: string;
  student: string;
  requester: string;
  dismissal: string;
  at: string;
  status: string;
}

interface Feed {
  groups: { grade: string; room: string | null; name: string }[];
  alerts: Alert[];
  inRoom: string[];
}

export default function TeacherClient() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher');
      if (!res.ok) throw new Error();
      setFeed(await res.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [load]);

  const sendNow = useCallback(
    async (itemId: string) => {
      await fetch('/api/board/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'EN_ROUTE', itemId }),
      }).catch(() => undefined);
      load();
    },
    [load],
  );

  const title = feed?.groups.length
    ? feed.groups.map((g) => `${g.name}${g.room ? ` · ${g.room}` : ''}`).join(', ')
    : 'My room';
  const waiting = feed?.alerts.filter((a) => a.status === 'REQUESTED') || [];
  const sent = feed?.alerts.filter((a) => a.status === 'EN_ROUTE') || [];

  return (
    <main className="mx-auto max-w-md px-4 py-5">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="font-serif text-lg font-semibold">{title}</h1>
        {waiting.length > 0 && (
          <span className="rounded-full bg-maroon px-2.5 py-0.5 font-mono text-xs font-bold text-white">
            {waiting.length} PICKUP
          </span>
        )}
        {stale && (
          <span className="rounded-full bg-crit-bg px-2.5 py-0.5 font-mono text-[10px] font-semibold text-crit">
            OFFLINE
          </span>
        )}
        <Link href="/" className="ml-auto text-sm text-maroon">
          Home
        </Link>
      </div>

      {feed && feed.groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-inkline px-4 py-8 text-center text-sm text-neutral-400">
          No grade is assigned to you yet. Ask the office to set your grade in the dashboard.
        </p>
      )}

      {waiting.map((a) => (
        <div key={a.itemId} className="mb-3 rounded-xl border-2 border-maroon bg-sunk p-4">
          <div className="font-mono text-[10px] tracking-widest text-maroon">PICKUP REQUEST</div>
          <div className="mt-1 font-serif text-2xl font-semibold">{a.student}</div>
          <div className="mt-1 text-sm text-neutral-600">{a.requester} is at the front</div>
          <div className="font-mono text-xs text-neutral-400">
            {a.dismissal.toLowerCase()} · asked {a.at}
          </div>
          <button
            onClick={() => sendNow(a.itemId)}
            className="kiosk-tap mt-3 w-full rounded-lg bg-maroon py-3 font-bold text-white"
          >
            Sending them now
          </button>
        </div>
      ))}

      {sent.map((a) => (
        <div key={a.itemId} className="mb-3 rounded-xl border border-inkline bg-white p-4">
          <div className="font-semibold">{a.student}</div>
          <div className="mt-0.5 text-sm text-good">On the way to the release desk ✓</div>
        </div>
      ))}

      {feed && waiting.length === 0 && sent.length === 0 && feed.groups.length > 0 && (
        <p className="rounded-xl border border-dashed border-inkline px-4 py-8 text-center text-sm text-neutral-400">
          No pickups waiting.
        </p>
      )}

      {feed && feed.groups.length > 0 && (
        <div className="mt-5 rounded-xl border border-inkline bg-white p-4">
          <div className="flex items-baseline font-mono text-[10px] uppercase tracking-widest text-neutral-400">
            In your room now <b className="ml-auto text-sm text-neutral-900">{feed.inRoom.length}</b>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            {feed.inRoom.length ? feed.inRoom.join(' · ') : 'Nobody yet.'}
          </p>
        </div>
      )}
    </main>
  );
}
