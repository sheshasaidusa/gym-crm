"use client";

import { usePageTitle } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useMe } from "@/lib/queries";

export function TopBarBreadcrumb() {
  const me = useMe();
  const title = usePageTitle();
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <span className="text-muted-foreground">{me.data?.gym.name ?? "dunamis"}</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        <BreadcrumbItem>
          <BreadcrumbPage>{title ?? "Dashboard"}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
