/**
 * Append a CHAIN_REBASELINE marker so audit verification re-anchors from here.
 *
 * Use this ONLY after a break whose cause is understood and fixed. It does not
 * and cannot repair history: the log has no update or delete path, the broken
 * rows stay exactly where they are, and the marker itself records who restarted
 * the chain and why. An auditor still sees the seam.
 *
 *   DEFAULT_TENANT_SLUG=dekalb-arts npx tsx scripts/rebaseline-audit.ts "reason"
 */
import { prisma } from '../src/lib/prisma';
import { auditNow, verifyChain, CHAIN_REBASELINE } from '../src/lib/audit';

const SLUG = process.env.DEFAULT_TENANT_SLUG || 'dekalb-arts';

async function main() {
  const reason = process.argv.slice(2).join(' ').trim();
  if (!reason) {
    console.error('A reason is required. It goes into the permanent record.');
    process.exit(2);
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });

  const before = await verifyChain(tenant.id);
  if (before === null) {
    console.log('Chain already verifies end to end. Nothing to rebaseline.');
    return;
  }
  console.log(`Chain is broken at seq ${before}.`);

  const priorMarkers = await prisma.auditLog.count({
    where: { tenantId: tenant.id, action: CHAIN_REBASELINE },
  });
  if (priorMarkers > 0) {
    console.log(
      `NOTE: ${priorMarkers} previous rebaseline marker(s) already exist. A recurring break means ` +
        'the underlying cause is not fixed. Investigate before adding another.',
    );
  }

  await auditNow({
    tenantId: tenant.id,
    actorKind: 'SYSTEM',
    actorName: 'rebaseline-audit',
    action: CHAIN_REBASELINE,
    entity: 'AuditLog',
    entityId: String(before),
    detail: `Chain re-anchored after a verified break at seq ${before}. ${reason}`,
  });

  const after = await verifyChain(tenant.id);
  console.log(
    after === null
      ? 'Chain verifies from the new anchor. Rows before the marker are sealed and unchanged.'
      : `STILL BROKEN at seq ${after}. Do not ignore this.`,
  );
  if (after !== null) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
