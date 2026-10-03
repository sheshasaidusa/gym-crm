import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-sm text-muted-foreground">The link may be old, or the page was moved.</p>
      <Button nativeButton={false} render={<Link href="/" />}>
        Go to the dashboard
      </Button>
    </main>
  );
}
