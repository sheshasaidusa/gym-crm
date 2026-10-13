"use client";

import { DumbbellIcon, HeartPulseIcon, HomeIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { useMemberMe } from "@/lib/member-app-queries";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/m", label: "Home", icon: HomeIcon },
  { href: "/m/plan", label: "Plan", icon: DumbbellIcon },
  { href: "/m/progress", label: "Progress", icon: HeartPulseIcon },
  { href: "/m/me", label: "Me", icon: UserRoundIcon },
];

/** Signed-in shell: the gym's colour on top, four tabs along the bottom. */
export default function MemberShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMemberMe();

  return (
    <div className="flex min-h-svh flex-col pb-20">
      <header
        className="px-5 pt-6 pb-5 text-white"
        style={{ backgroundColor: me.data?.gym.brand_color ?? "var(--primary)" }}
      >
        {me.data ? (
          <div className="flex items-center gap-3">
            {me.data.gym.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- external gym logo
              <img src={me.data.gym.logo_url} alt="" className="size-9 rounded-lg bg-white object-contain" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-lg bg-white/20">
                <DumbbellIcon className="size-5" aria-hidden />
              </span>
            )}
            <span className="font-semibold">{me.data.gym.name}</span>
          </div>
        ) : (
          <Skeleton className="h-9 w-40 bg-white/20" />
        )}
      </header>

      <main className="flex-1 px-4 py-5">{children}</main>

      <nav
        aria-label="Member app"
        className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-md grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/m" ? pathname === "/m" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-xs outline-none",
                active ? "font-medium text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
