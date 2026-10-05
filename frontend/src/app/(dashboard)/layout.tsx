import { AppSidebar } from "@/components/app-sidebar";
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
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
            <span className="text-sm text-muted-foreground">dunamis</span>
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </SessionGate>
  );
}
