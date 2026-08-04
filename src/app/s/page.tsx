import { requireSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import BoardClient from './BoardClient';

export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect('/login?next=/s');
  return <BoardClient />;
}
