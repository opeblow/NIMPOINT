import { Wordmark } from "./ui";

/** First paint while the app boots: same layout as the real screen, so nothing jumps. */
export function AppSkeleton({ minimal = false }: { minimal?: boolean }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark />
        <span className="h-8 w-28 animate-pulse rounded-full bg-paper-2" />
      </header>
      {minimal ? (
        <div className="mt-6 space-y-3">
          <div className="h-9 w-3/4 animate-pulse rounded-xl bg-paper-2" />
          <div className="h-48 animate-pulse rounded-[28px] bg-paper-2" />
        </div>
      ) : (
        <>
          <div className="mt-1 h-[196px] animate-pulse rounded-[28px] bg-ink/90" />
          <div className="mt-4 h-12 animate-pulse rounded-full bg-paper-2" />
          <div className="flex flex-1 items-center justify-center">
            <span className="text-[60px] font-semibold tracking-[-0.045em] text-ink/15">
              ₦0
            </span>
          </div>
        </>
      )}
    </div>
  );
}
