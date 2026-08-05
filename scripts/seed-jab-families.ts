/**
 * Seed the two JAB test families so Walter and Alysia can run the real pickup
 * flow end to end on their own phones.
 *
 *   Jordan family  -> Walter Jordan   -> Christina Jordan, Crystal Jordan
 *   Borden family  -> Alysia Borden   -> McKenzie Borden, Monroe Borden
 *
 * Idempotent: re-running matches on family name + guardian name + student
 * name, so it updates rather than duplicating. parentToken is never
 * regenerated once issued, so a link already sent keeps working.
 *
 *   DEFAULT_TENANT_SLUG=dekalb-arts npx tsx scripts/seed-jab-families.ts
 */
import { prisma } from '../src/lib/prisma';
import { auditNow } from '../src/lib/audit';
import { normalizePhone } from '../src/lib/phone';

const SLUG = process.env.DEFAULT_TENANT_SLUG || 'dekalb-arts';

const FAMILIES = [
  {
    family: 'Jordan family',
    guardian: {
      firstName: 'Walter', lastName: 'Jordan',
      phone: '+17703132589', email: 'walterjordan@jordanborden.com',
      relationship: 'Parent',
    },
    students: [
      { firstName: 'Christina', lastName: 'Jordan', grade: '3' },
      { firstName: 'Crystal', lastName: 'Jordan', grade: '5' },
    ],
  },
  {
    family: 'Borden family',
    guardian: {
      firstName: 'Alysia', lastName: 'Borden',
      phone: '+14049939583', email: 'alysia@jordanborden.com',
      relationship: 'Parent',
    },
    students: [
      { firstName: 'McKenzie', lastName: 'Borden', grade: 'K' },
      { firstName: 'Monroe', lastName: 'Borden', grade: '2' },
    ],
  },
];

async function uniquePin(tenantId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const clash = await prisma.household.findUnique({ where: { tenantId_pin: { tenantId, pin } } });
    if (!clash) return pin;
  }
  throw new Error('could not allocate a unique PIN');
}

async function ensureClassGroup(tenantId: string, grade: string): Promise<string> {
  const existing = await prisma.classGroup.findFirst({ where: { tenantId, grade, active: true } });
  if (existing) return existing.id;
  const created = await prisma.classGroup.create({
    data: { tenantId, grade, name: grade === 'K' ? 'Kindergarten' : `Grade ${grade}` },
  });
  return created.id;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const base = (process.env.APP_BASE_URL || 'https://pickup.jordanborden.com').replace(/\/+$/, '');

  for (const f of FAMILIES) {
    let household = await prisma.household.findFirst({ where: { tenantId: tenant.id, name: f.family } });
    if (!household) {
      household = await prisma.household.create({
        data: { tenantId: tenant.id, name: f.family, pin: await uniquePin(tenant.id) },
      });
      await auditNow({
        tenantId: tenant.id, actorKind: 'STAFF', actorName: 'seed-jab-families',
        action: 'HOUSEHOLD_ADDED', entity: 'Household', entityId: household.id,
        detail: `Family "${f.family}" created.`,
      });
    }

    const gData = {
      firstName: f.guardian.firstName,
      lastName: f.guardian.lastName,
      phone: normalizePhone(f.guardian.phone),
      email: f.guardian.email,
      relationship: f.guardian.relationship,
      isPrimary: true,
      canPickup: true,
      notify: true,
    };
    let guardian = await prisma.guardian.findFirst({
      where: { householdId: household.id, firstName: gData.firstName, lastName: gData.lastName },
    });
    if (guardian) {
      guardian = await prisma.guardian.update({ where: { id: guardian.id }, data: gData });
    } else {
      guardian = await prisma.guardian.create({ data: { ...gData, householdId: household.id } });
      await auditNow({
        tenantId: tenant.id, actorKind: 'STAFF', actorName: 'seed-jab-families',
        action: 'GUARDIAN_ADDED', entity: 'Guardian', entityId: guardian.id,
        detail: `${gData.firstName} ${gData.lastName} added to ${f.family}.`,
      });
    }

    for (const st of f.students) {
      const sData = {
        firstName: st.firstName,
        lastName: st.lastName,
        grade: st.grade,
        householdId: household.id,
        active: true,
        dismissalDefault: 'CARLINE',
        classGroupId: await ensureClassGroup(tenant.id, st.grade),
      };
      const existing = await prisma.student.findFirst({
        where: { tenantId: tenant.id, firstName: st.firstName, lastName: st.lastName },
      });
      if (existing) {
        await prisma.student.update({ where: { id: existing.id }, data: sData });
      } else {
        const created = await prisma.student.create({ data: { ...sData, tenantId: tenant.id } });
        await auditNow({
          tenantId: tenant.id, actorKind: 'STAFF', actorName: 'seed-jab-families',
          action: 'STUDENT_ADDED', entity: 'Student', entityId: created.id,
          detail: `${st.firstName} ${st.lastName} (grade ${st.grade}) added to ${f.family}.`,
        });
      }
    }

    const kids = await prisma.student.findMany({
      where: { householdId: household.id, active: true }, orderBy: { firstName: 'asc' },
    });
    console.log('');
    console.log(`${f.family}`);
    console.log(`  PIN          ${household.pin}`);
    console.log(`  guardian     ${guardian.firstName} ${guardian.lastName}  ${guardian.phone}  ${guardian.email}`);
    console.log(`  students     ${kids.map((k) => `${k.firstName} (${k.grade === 'K' ? 'K' : `Gr ${k.grade}`})`).join(', ')}`);
    console.log(`  parent link  ${base}/p/${guardian.parentToken}`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
