"use client";

import {
  BarChart3Icon,
  ChevronsUpDownIcon,
  ClipboardListIcon,
  FileUpIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
  MagnetIcon,
  CheckIcon,
  BellRingIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ROLE_LABELS,
  useLogout,
  useMe,
  useSwitchGym,
  type Role,
} from "@/lib/queries";
import { useLeadStats } from "@/lib/lead-queries";
import { useDueReminders } from "@/lib/reminder-queries";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  hideFor?: Role[];
};

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3Icon,
        hideFor: ["trainer", "front_desk"],
      },
    ],
  },
  {
    label: "Members",
    items: [
      { title: "Members", href: "/members", icon: UsersIcon },
      { title: "Plans", href: "/plans", icon: ClipboardListIcon },
      {
        title: "Reminders",
        href: "/reminders",
        icon: BellRingIcon,
        hideFor: ["trainer"],
      },
      {
        title: "Check-ups",
        href: "/checkups",
        icon: HeartPulseIcon,
      },
      { title: "Leads", href: "/leads", icon: MagnetIcon },
    ],
  },
  {
    label: "Business",
    items: [
      {
        title: "Finance",
        href: "/finance",
        icon: WalletIcon,
        hideFor: ["trainer"],
      },
      {
        title: "Import data",
        href: "/import",
        icon: FileUpIcon,
        hideFor: ["trainer", "front_desk"],
      },
      { title: "Settings", href: "/settings", icon: SettingsIcon },
    ],
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AppSidebar() {
  const pathname = usePathname();
  const me = useMe();
  const logout = useLogout();
  const switchGym = useSwitchGym();

  const role = me.data?.role;
  const due = useDueReminders(undefined, !!role && role !== "trainer");
  // Reminders nobody has sent yet (by email or WhatsApp).
  const pendingReminders =
    due.data?.items.filter(
      (i) => i.email_status !== "sent" && !i.whatsapp_sent_at,
    ).length ?? 0;
  const leadStats = useLeadStats(!!role);
  const dueFollowUps = leadStats.data?.follow_ups_due ?? 0;
  const badgeFor = (href: string) =>
    href === "/reminders" && pendingReminders > 0
      ? String(pendingReminders)
      : href === "/leads" && dueFollowUps > 0
        ? String(dueFollowUps)
        : null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border bg-sidebar-accent">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground group-data-[collapsible=icon]:size-8"
              >
                {me.data?.gym.name.charAt(0).toUpperCase()}
              </span>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                {me.data ? (
                  <>
                    <span className="truncate font-medium">
                      {me.data.gym.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      dunamis
                    </span>
                  </>
                ) : (
                  <Skeleton className="h-4 w-24" />
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label} className="border-b border-sidebar-border py-3 last:border-b-0">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items
                .filter((item) => !(role && item.hideFor?.includes(role)))
                .map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item.href)}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {badgeFor(item.href) && (
                      <SidebarMenuBadge className="bg-red-500/15 text-red-600 dark:text-red-400">
                        {badgeFor(item.href)}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {me.data ? initials(me.data.user.name) : ""}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {me.data?.user.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {me.data ? ROLE_LABELS[me.data.role] : ""}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {me.data?.user.email}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                {me.data && me.data.gyms.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Switch gym
                      </DropdownMenuLabel>
                      {me.data.gyms.map((g) => (
                        <DropdownMenuItem
                          key={g.gym_id}
                          disabled={g.gym_id === me.data.gym.id}
                          onClick={() => switchGym.mutate(g.gym_id)}
                        >
                          <span className="flex-1 truncate">{g.gym_name}</span>
                          {g.gym_id === me.data.gym.id && <CheckIcon />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout.mutate()}>
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** "Gym / Page" for the top bar, named from the same nav list as the sidebar. */
export function TopBarCrumb() {
  const pathname = usePathname();
  const me = useMe();
  const page = NAV.flatMap((g) => g.items)
    .filter((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)))
    .at(-1);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="truncate text-muted-foreground">{me.data?.gym.name ?? "dunamis"}</span>
      {page && (
        <>
          <span aria-hidden className="text-muted-foreground/50">/</span>
          <span className="flex items-center gap-1.5 truncate text-foreground">
            <page.icon className="size-3.5 shrink-0" />
            {page.title}
          </span>
        </>
      )}
    </nav>
  );
}
