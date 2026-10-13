import { WifiOffIcon } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-8 text-center">
      <WifiOffIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted-foreground">
        Connect to the internet to see your membership and plan.
      </p>
    </main>
  );
}
