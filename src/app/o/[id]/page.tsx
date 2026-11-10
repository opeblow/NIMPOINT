import { Suspense } from 'react';
import { AppSkeleton } from '@/components/Skeleton';
import { OrderScreen } from '@/components/OrderScreen';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<AppSkeleton minimal />}>
      <OrderScreen id={id.toUpperCase()} />
    </Suspense>
  );
}
