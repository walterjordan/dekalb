// Append-only, hash-chained audit log. Every state-changing action calls
// audit() inside the same transaction as the change. There is no update or
// delete path anywhere in the API; mistakes are corrected by appending.
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  tenantId: string;
  actorKind: 'STAFF' | 'GUARDIAN' | 'DEVICE' | 'SYSTEM';
  actorId?: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId?: string | null;
  detail: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Action marking a deliberate restart of the chain. Verification accepts one
 * of these without checking its link and re-anchors on it. See rebaseline().
 */
export const CHAIN_REBASELINE = 'CHAIN_REBASELINE';

export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  // Serialise appends per tenant for the rest of this transaction.
  //
  // Without this, reading the tail and then inserting is a classic read-modify-
  // write race: two concurrent actions both read the same previous hash, both
  // chain off it, and the second one's prevHash points at the wrong parent.
  // That happened for real on 2026-08-05 (a Google sign-in landed mid-pickup)
  // and broke the chain at seq 119.
  //
  // It matters more than a failing test. This chain is the tamper-evidence for
  // a child-safety ledger, so "broken" has to mean "somebody altered the
  // record". If two parents arriving in the same second can break it, the
  // signal is noise and noise gets ignored.
  //
  // A transaction-scoped advisory lock releases automatically on commit or
  // rollback, so there is no unlock path to leak. It is keyed on the tenant,
  // so tenants never block each other.
  // $executeRaw, not $queryRaw: the function returns void and $queryRaw fails
  // trying to deserialise a void column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${e.tenantId}))`;

  const prev = await tx.auditLog.findFirst({
    where: { tenantId: e.tenantId },
    orderBy: { seq: 'desc' },
    select: { hash: true },
  });
  const prevHash = prev?.hash || 'genesis';
  const hash = createHash('sha256')
    .update(prevHash)
    .update(e.action)
    .update(e.entity)
    .update(e.entityId || '')
    .update(e.detail)
    .update(e.actorName)
    .digest('hex');
  await tx.auditLog.create({
    data: {
      tenantId: e.tenantId,
      actorKind: e.actorKind,
      actorId: e.actorId || null,
      actorName: e.actorName,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId || null,
      detail: e.detail,
      data: e.data,
      prevHash,
      hash,
    },
  });
}

/** Convenience for non-transactional call sites (still atomic per entry). */
export async function auditNow(e: AuditEntry): Promise<void> {
  await prisma.$transaction((tx) => audit(tx, e));
}

/**
 * Verify the chain for a tenant. Returns the first broken seq, or null if intact.
 *
 * Verification starts at the most recent CHAIN_REBASELINE marker rather than at
 * genesis. A marker declares that everything before it is sealed: those rows
 * still exist, unchanged and readable, but their linkage is no longer asserted
 * because the break they contain is known, explained and recorded in the marker
 * itself.
 *
 * This is deliberately a VISIBLE escape hatch. Appending a marker erases
 * nothing (the log has no update or delete path) and the marker names who did
 * it and why, so a reader always sees exactly where the chain was restarted.
 * A second marker is a question worth asking, which is why rebaseline-audit.ts
 * reports how many already exist.
 */
export async function verifyChain(tenantId: string): Promise<bigint | null> {
  const anchor = await prisma.auditLog.findFirst({
    where: { tenantId, action: CHAIN_REBASELINE },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });

  const rows = await prisma.auditLog.findMany({
    where: { tenantId, ...(anchor ? { seq: { gt: anchor.seq } } : {}) },
    orderBy: { seq: 'asc' },
    select: { seq: true, action: true, entity: true, entityId: true, detail: true, actorName: true, prevHash: true, hash: true },
  });

  let prev = anchor ? anchor.hash : 'genesis';
  for (const r of rows) {
    const expect = createHash('sha256')
      .update(prev)
      .update(r.action)
      .update(r.entity)
      .update(r.entityId || '')
      .update(r.detail)
      .update(r.actorName)
      .digest('hex');
    if (r.prevHash !== prev || r.hash !== expect) return r.seq;
    prev = r.hash;
  }
  return null;
}
