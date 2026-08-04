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

export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
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

/** Verify the chain for a tenant. Returns the first broken seq, or null if intact. */
export async function verifyChain(tenantId: string): Promise<bigint | null> {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { seq: 'asc' },
    select: { seq: true, action: true, entity: true, entityId: true, detail: true, actorName: true, prevHash: true, hash: true },
  });
  let prev = 'genesis';
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
