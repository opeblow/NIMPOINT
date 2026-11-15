import { Suspense } from 'react';
import { Landing } from '@/components/Landing';

export default function Home() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
