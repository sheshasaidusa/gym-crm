import type { Metadata, Viewport } from "next";

import { RegisterServiceWorker } from "@/components/member-app/register-sw";

export const metadata: Metadata = {
  title: { default: "My gym", template: "%s · My gym" },
  description: "Your membership, trainer, workout plan and progress.",
  manifest: "/m/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "My gym", statusBarStyle: "default" },
  icons: { apple: "/m/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#2a78d6",
  width: "device-width",
  initialScale: 1,
};

/** The member app: a phone-sized column, installable from the browser. */
export default function MemberAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40">
      <div className="mx-auto min-h-svh max-w-md bg-background shadow-sm sm:border-x">{children}</div>
      <RegisterServiceWorker />
    </div>
  );
}
