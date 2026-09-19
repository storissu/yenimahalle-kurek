import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { tr } from '@/strings/tr';

/** Placeholder for sections that arrive in later development phases. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Hammer} title={tr.common.soonTitle} body={tr.common.soonBody} />
    </>
  );
}
