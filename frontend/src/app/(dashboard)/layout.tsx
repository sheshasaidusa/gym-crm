import { AppSidebar, NavUser } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { SessionGate } from "@/components/session-gate";
import { TopBarBreadcrumb } from "@/components/top-bar-breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// Shell layout adapted from gray-ui-csm by Jason-uxui (MIT).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-4 bg-background p-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
              <TopBarBreadcrumb />
            </div>
            <div className="flex h-9 items-center gap-2 sm:gap-3">
              <NotificationBell />
              <ThemeToggle />
              <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-auto" />
              <NavUser />
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-500 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6 lg:p-8 lg:pt-2">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </SessionGate>
  );
}
