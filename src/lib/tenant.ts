import { prisma } from '@/lib/prisma';
import type { Tenant } from '@prisma/client';

// Single-tenant resolution for v1: the service serves DEFAULT_TENANT_SLUG.
// Token-authed public routes (kiosk / parent / approval) resolve tenant from
// the token's owning row instead, so multi-tenant needs no URL change later.
const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'dekalb-arts';

export async function getTenant(): Promise<Tenant | null> {
  return prisma.tenant.findUnique({ where: { slug: DEFAULT_SLUG } });
}

export async function requireTenant(): Promise<Tenant> {
  const t = await getTenant();
  if (!t) throw new Error(`Tenant ${DEFAULT_SLUG} is not provisioned`);
  return t;
}

export interface TenantVocab {
  studentSingular: string;
  guardianSingular: string;
  orgShort: string;
}

export function vocabOf(t: Tenant): TenantVocab {
  const s = (t.settings || {}) as Record<string, unknown>;
  const v = (s.vocabulary || {}) as Record<string, string>;
  return {
    studentSingular: v.student || 'student',
    guardianSingular: v.guardian || 'parent',
    orgShort: v.orgShort || t.name.split(' ')[0] || t.name,
  };
}
