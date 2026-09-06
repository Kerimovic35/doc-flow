import { Skeleton } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 md:px-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
