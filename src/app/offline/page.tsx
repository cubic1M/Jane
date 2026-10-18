// Shown by the service worker when there's no connection. Static, so it can be cached.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Jane needs a connection to show your accounts. Check your connection and try again.
      </p>
    </main>
  );
}
