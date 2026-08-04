// Seed: tenant + Walter as admin + synthetic K-8 demo data (safe to re-run).
// Real Dekalb data replaces the synthetic families via /admin/import later —
// synthetic rows are all flagged with notes:'demo-seed' for easy cleanup.
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const FIRST = ['Ava', 'Maya', 'Eli', 'Amir', 'Zuri', 'Noah', 'Priya', 'Ruth', 'Caleb', 'Dorian', 'Brianna', 'Micah', 'Elena', 'Jordan', 'Imani', 'Kofi', 'Lena', 'Marcus', 'Nia', 'Owen', 'Sanaa', 'Theo', 'Uma', 'Victor', 'Willow', 'Xavier', 'Yara', 'Zane', 'Amara', 'Bryce', 'Chloe', 'Denver', 'Esme', 'Femi', 'Gia', 'Hakeem', 'Ivy', 'Jalen', 'Kira', 'Liam'];
const LAST = ['Johnson', 'Thomas', 'Cole', 'Ruiz', 'Pace', 'Bell', 'Kim', 'Shah', 'Mensah', 'Vargas', 'Carter', 'Osei', 'Nguyen', 'Baker', 'Diaz', 'Ellis', 'Frost', 'Grant', 'Hale', 'Irving', 'James', 'Kane', 'Lopez', 'Moore', 'Nash'];
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'dekalb-arts' },
    update: {},
    create: {
      slug: 'dekalb-arts',
      name: 'Dekalb Arts Academy Afterschool Care',
      timezone: 'America/New_York',
      programStart: '15:00',
      programEnd: '18:00',
      lateThresholdMinutes: 10,
      lateFeeCents: 100,
      lateFeeBlockMinutes: 1,
      settings: { brand: { colors: ['#7B1E2B', '#FFFFFF', '#6E6E6E'] }, vocabulary: { orgShort: 'Dekalb Arts' } },
    },
  });
  console.log('tenant', tenant.slug);

  // Walter as bootstrap admin.
  const walter = await prisma.staffUser.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'walterjordan@jordanborden.com' } },
    update: { role: 'ADMIN', active: true },
    create: {
      tenantId: tenant.id,
      name: 'Walter Jordan',
      email: 'walterjordan@jordanborden.com',
      phone: '+17703132589',
      role: 'ADMIN',
    },
  });
  console.log('admin', walter.name);

  if (process.env.SEED_DEMO !== '1') {
    console.log('SEED_DEMO != 1 — skipping synthetic data.');
    return;
  }

  // Teachers, one per grade. Phones intentionally invalid-but-well-formed test
  // numbers (555) so a drain can never text a real stranger.
  const teachers = {};
  for (let i = 0; i < GRADES.length; i++) {
    const g = GRADES[i];
    const name = `${['M. Brooks', 'D. Warren', 'L. Chen', 'R. Mills', 'S. Adams', 'T. Okafor', 'J. Rivera', 'K. Patel', 'A. Wright'][i]}`;
    const t = await prisma.staffUser.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: `teacher${g.toLowerCase()}@demo.local` } },
      update: {},
      create: {
        tenantId: tenant.id, name, role: 'TEACHER',
        email: `teacher${g.toLowerCase()}@demo.local`,
        phone: `+1404555${String(1000 + i).padStart(4, '0')}`,
      },
    });
    const grp = await prisma.classGroup.findFirst({ where: { tenantId: tenant.id, grade: g, active: true } });
    const room = g === 'K' ? 'Rm 100' : Number(g) <= 5 ? `Rm 10${g}` : 'Gym';
    if (grp) await prisma.classGroup.update({ where: { id: grp.id }, data: { teacherId: t.id, room } });
    else {
      teachers[g] = await prisma.classGroup.create({
        data: { tenantId: tenant.id, grade: g, name: g === 'K' ? 'Kindergarten' : `Grade ${g}`, teacherId: t.id, room },
      });
      continue;
    }
    teachers[g] = await prisma.classGroup.findFirst({ where: { tenantId: tenant.id, grade: g, active: true } });
  }

  // 25 households, 40 students.
  const existing = await prisma.student.count({ where: { tenantId: tenant.id } });
  if (existing > 0) {
    console.log(`students already present (${existing}) — skipping synthetic families.`);
    return;
  }

  let f = 0;
  let s = 0;
  const usedPins = new Set();
  for (let hIdx = 0; hIdx < 25; hIdx++) {
    const last = LAST[hIdx % LAST.length];
    let pin;
    do pin = String(1000 + Math.floor(Math.random() * 9000));
    while (usedPins.has(pin));
    usedPins.add(pin);

    const household = await prisma.household.create({
      data: {
        tenantId: tenant.id,
        name: `${last} family`,
        pin,
        notes: 'demo-seed',
        balanceCents: hIdx % 7 === 0 ? 8500 : 0,
        balanceNote: hIdx % 7 === 0 ? 'Activity fee' : null,
      },
    });
    f++;
    const gFirst = FIRST[(hIdx * 3 + 11) % FIRST.length];
    await prisma.guardian.create({
      data: {
        householdId: household.id,
        firstName: gFirst,
        lastName: last,
        phone: `+1404555${String(2000 + hIdx).padStart(4, '0')}`,
        isPrimary: true,
        parentToken: randomBytes(12).toString('base64url'),
      },
    });
    // 1-3 students per household.
    const n = hIdx % 3 === 0 ? 2 : hIdx % 5 === 0 ? 3 : 1;
    for (let k = 0; k < n && s < 40; k++) {
      const grade = GRADES[(hIdx + k * 3) % GRADES.length];
      const grp = await prisma.classGroup.findFirst({ where: { tenantId: tenant.id, grade, active: true } });
      await prisma.student.create({
        data: {
          tenantId: tenant.id,
          householdId: household.id,
          firstName: FIRST[(hIdx * 2 + k * 7) % FIRST.length],
          lastName: last,
          grade,
          classGroupId: grp?.id || null,
        },
      });
      s++;
    }
  }

  // One temporary authorized adult + one restriction, per the verification plan.
  const first = await prisma.household.findFirst({ where: { tenantId: tenant.id, notes: 'demo-seed' }, include: { students: true } });
  if (first) {
    const eod = new Date();
    eod.setHours(23, 59, 0, 0);
    await prisma.authorizedAdult.create({
      data: { householdId: first.id, name: 'Nina Patel', relationship: 'Family friend', expiresAt: eod, verifiedAt: new Date(), createdVia: 'ADMIN' },
    });
    await prisma.pickupRestriction.create({
      data: {
        tenantId: tenant.id,
        householdId: first.id,
        studentId: first.students[0]?.id || null,
        restrictedName: 'Marcus Webb',
        sourceNote: 'Custody order on file (demo)',
        staffOnlyDetail: 'Demo restriction — front office only.',
        reviewedBy: 'seed',
        reviewedAt: new Date(),
      },
    });
  }

  // A demo kiosk device with a KNOWN token for local testing only.
  const demoToken = 'demo-kiosk-token';
  await prisma.device.upsert({
    where: { tokenHash: sha256(demoToken) },
    update: {},
    create: { tenantId: tenant.id, label: 'Demo iPad', location: 'Front door', tokenHash: sha256(demoToken), kind: 'KIOSK' },
  });

  console.log(`seeded ${f} families, ${s} students. Kiosk: /k/${demoToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
