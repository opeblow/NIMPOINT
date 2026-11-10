import { Suspense } from 'react';
import { Flow } from '@/components/Flow';
import { PinGate } from '@/components/PinGate';
import { AppSkeleton } from '@/components/Skeleton';

export default function AppHome() {
  return (
    <PinGate>
      <Suspense fallback={<AppSkeleton />}>
        <Flow />
      </Suspense>
    </PinGate>
  );
}
