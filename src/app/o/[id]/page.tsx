import { Suspense } from 'react';
import { OrderScreen } from '@/components/OrderScreen';
import { PinGate } from '@/components/PinGate';
import { AppSkeleton } from '@/components/Skeleton';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PinGate>
      <Suspense fallback={<AppSkeleton minimal />}>
        <OrderScreen id={id.toUpperCase()} />
      </Suspense>
    </PinGate>
  );
}
