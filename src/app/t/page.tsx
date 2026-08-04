import { requireSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TeacherClient from './TeacherClient';

export const dynamic = 'force-dynamic';

export default async function TeacherPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect('/login?next=/t');
  return <TeacherClient />;
}
