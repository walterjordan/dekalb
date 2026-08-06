import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/tenant';
import { requireSession } from '@/lib/auth';
import { gradeRoll, markStudent, GRADES } from '@/lib/rollcall';
import { timeLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function mark(formData: FormData) {
  'use server';
  const session = await requireSession();
  const tenant = await requireTenant();
  const studentId = String(formData.get('studentId') || '');
  const action = String(formData.get('mark') || '') as 'CHECK_IN' | 'UNDO' | 'ABSENT';
  try {
    await markStudent(tenant, studentId, action, {
      staffId: session.staffId,
      name: session.name,
      role: session.role,
    });
  } catch {
    // Guarded actions (undo after release, undo mid-pickup) fail silently here;
    // the register re-renders with the true state.
  }
  revalidatePath('/roll');
}

export default async function RollCallPage({
  searchParams,
}: {
  searchParams: { grade?: string };
}) {
  await requireSession();
  const tenant = await requireTenant();
  const grade = GRADES.includes((searchParams.grade || 'K') as (typeof GRADES)[number])
    ? searchParams.grade || 'K'
    : 'K';
  const roll = await gradeRoll(tenant, grade);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-serif text-xl font-semibold">Afternoon roll call</h1>
        <Link href="/" className="text-sm text-maroon hover:underline">
          Home
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {GRADES.map((g) => (
          <Link
            key={g}
            href={`/roll?grade=${g}`}
            className={`kiosk-tap grid min-w-12 place-items-center rounded-md border px-3 py-2 font-mono text-sm ${
              g === grade
                ? 'border-maroon bg-maroon font-bold text-white'
                : 'border-inkline bg-white text-neutral-600 hover:border-maroon'
            }`}
          >
            {g}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-inkline bg-white shadow-sm">
        <div className="flex flex-wrap items-baseline gap-3 border-b border-inkline px-4 py-3">
          <span className="font-semibold">Grade {grade}</span>
          {roll.room ? <span className="font-mono text-xs text-neutral-500">{roll.room}</span> : null}
          {roll.teacher ? <span className="font-mono text-xs text-neutral-500">{roll.teacher}</span> : null}
          <span className="ml-auto rounded-full bg-good-bg px-3 py-0.5 font-mono text-xs font-semibold text-good">
            {roll.counts.in} of {roll.counts.total} in
          </span>
          {roll.counts.absent > 0 ? (
            <span className="rounded-full bg-warn-bg px-3 py-0.5 font-mono text-xs font-semibold text-warn">
              {roll.counts.absent} absent
            </span>
          ) : null}
        </div>

        {roll.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No students in grade {grade} yet. Add them in the{' '}
            <Link href="/admin/students" className="text-maroon underline">
              dashboard
            </Link>
            .
          </p>
        ) : (
          <ul>
            {roll.rows.map((r) => (
              <li
                key={r.studentId}
                className="flex items-center gap-3 border-b border-inkline px-4 py-2.5 last:border-b-0"
              >
                <span
                  className={`grid h-6 w-6 flex-none place-items-center rounded-full border-2 text-xs font-bold ${
                    r.state === 'CHECKED_IN' || r.state === 'RELEASED'
                      ? 'border-good bg-good text-white'
                      : r.state === 'ABSENT'
                        ? 'border-warn bg-warn-bg text-warn'
                        : 'border-inkline text-transparent'
                  }`}
                  role="img"
                  title={
                    r.state === 'ABSENT'
                      ? 'Absent'
                      : r.state === 'CHECKED_IN' || r.state === 'RELEASED'
                        ? 'Checked in'
                        : 'Not marked yet'
                  }
                  aria-label={
                    r.state === 'ABSENT'
                      ? 'Absent'
                      : r.state === 'CHECKED_IN' || r.state === 'RELEASED'
                        ? 'Checked in'
                        : 'Not marked yet'
                  }
                >
                  {r.state === 'ABSENT' ? '!' : '✓'}
                </span>
                <span className={`font-medium ${r.state === 'RELEASED' ? 'text-neutral-400 line-through' : ''}`}>
                  {r.name}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {r.state === 'CHECKED_IN' ? (
                    <>
                      <span className="font-mono text-xs text-neutral-400">
                        in {timeLabel(r.at, tenant.timezone)}
                      </span>
                      <form action={mark}>
                        <input type="hidden" name="studentId" value={r.studentId} />
                        <input type="hidden" name="mark" value="UNDO" />
                        <button className="kiosk-tap rounded-md px-2 py-1 text-xs text-neutral-400 hover:text-crit">
                          undo
                        </button>
                      </form>
                    </>
                  ) : r.state === 'RELEASED' ? (
                    <span className="font-mono text-xs text-neutral-400">Picked up</span>
                  ) : r.state === 'ABSENT' ? (
                    <form action={mark}>
                      <input type="hidden" name="studentId" value={r.studentId} />
                      <input type="hidden" name="mark" value="UNDO" />
                      <button className="kiosk-tap rounded-md px-2 py-1 text-xs text-neutral-400 hover:text-crit">
                        undo
                      </button>
                    </form>
                  ) : (
                    <>
                      <form action={mark}>
                        <input type="hidden" name="studentId" value={r.studentId} />
                        <input type="hidden" name="mark" value="ABSENT" />
                        <button className="kiosk-tap rounded-md border border-inkline px-3 py-1.5 text-xs text-neutral-500 hover:border-warn hover:text-warn">
                          Absent
                        </button>
                      </form>
                      <form action={mark}>
                        <input type="hidden" name="studentId" value={r.studentId} />
                        <input type="hidden" name="mark" value="CHECK_IN" />
                        <button className="kiosk-tap rounded-md bg-maroon px-4 py-1.5 text-sm font-semibold text-white hover:bg-maroon-light">
                          Check in
                        </button>
                      </form>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-neutral-400">
        Not marked and absent mean different things. A student you never marked shows up as
        &quot;attendance not marked&quot; on the director&apos;s dashboard. A student marked absent does not.
      </p>
    </main>
  );
}
