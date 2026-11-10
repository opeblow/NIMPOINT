import { Suspense } from 'react';
import { AppSkeleton } from '@/components/Skeleton';
import { Flow } from '@/components/Flow';

export default function Home() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <Flow />
    </Suspense>
  );
}
