'use client';
import { useState } from 'react';

interface Kid {
  id: string;
  name: string;
  grade: string;
  status: string;
  eligible: boolean;
}

export default function ParentClient({
  token,
  tenantName,
  guardianName,
  qr,
  students,
  approved,
}: {
  token: string;
  tenantName: string;
  guardianName: string;
  qr: string;
  students: Kid[];
  approved: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const eligible = students.filter((s) => s.eligible);

  async function imHere() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/parent/${token}/request`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setMsg('Request sent. We will text you when they are at the door.');
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-5 py-6">
      <h1 className="text-center font-serif text-xl font-semibold">{tenantName}</h1>
      <p className="mt-0.5 text-center text-sm text-neutral-500">{guardianName}</p>

      {qr ? (
        <div className="mx-auto mt-5 w-56 rounded-2xl border border-inkline bg-white p-4 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Your family pickup code" className="w-full" />
        </div>
      ) : null}
      <p className="mt-2 text-center text-sm text-neutral-500">Show this at the front desk iPad</p>

      <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
        <span className="h-px flex-1 bg-inkline" /> or <span className="h-px flex-1 bg-inkline" />
      </div>

      <button
        disabled={busy || !eligible.length}
        onClick={imHere}
        className="kiosk-tap w-full rounded-xl bg-maroon py-4 text-lg font-bold text-white disabled:opacity-40"
      >
        {busy ? 'Sending…' : "I'm here - request pickup"}
      </button>
      {!eligible.length && !msg ? (
        <p className="mt-2 text-center text-xs text-neutral-400">
          You can request pickup once your children are checked in, as long as there is not one already underway.
        </p>
      ) : null}
      {msg ? <p className="mt-3 rounded-md bg-good-bg px-3 py-2 text-center text-sm text-good">{msg}</p> : null}

      <div className="mt-6 rounded-xl border border-inkline bg-white p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">Your children</div>
        {students.map((s) => (
          <div key={s.id} className="mt-2.5 flex items-baseline gap-2">
            <span className="font-semibold">{s.name}</span>
            <span className="font-mono text-xs text-neutral-400">Gr {s.grade}</span>
            <span
              className={`ml-auto text-xs font-semibold ${
                s.status.startsWith('READY') ? 'text-good' : s.status === 'Present' ? 'text-neutral-500' : 'text-neutral-400'
              }`}
            >
              {s.status}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-inkline bg-white p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">Approved for pickup</div>
        <p className="mt-2 text-sm text-neutral-600">{approved.join(' · ')}</p>
        <p className="mt-2 text-xs text-neutral-400">
          To add someone, call the front desk. You can also approve a new person by text the first time they arrive.
        </p>
      </div>
    </main>
  );
}
