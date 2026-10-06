import { AppSidebar, TopBarCrumb } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { SessionGate } from "@/components/session-gate";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
            <TopBarCrumb />
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-5 p-4 md:px-6 md:py-5">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </SessionGate>
  );
}
