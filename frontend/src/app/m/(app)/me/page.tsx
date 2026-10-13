"use client";

import { LogOutIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { mApi } from "@/lib/api/client";
import { useMemberMe } from "@/lib/member-app-queries";

export default function MemberMePage() {
  const me = useMemberMe();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await mApi.POST("/api/m/auth/logout");
    // A full page load drops every cached query, so the next person on this phone sees nothing of ours.
    window.location.replace("/m/login");
  }

  if (me.isPending) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (me.isError) return <p className="text-sm text-destructive">{me.error.message}</p>;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardDescription>Signed in as</CardDescription>
          <CardTitle className="text-lg">{me.data.member_name}</CardTitle>
          <p className="text-sm text-muted-foreground">{me.data.gym.name}</p>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 border-t pt-4">
          <span className="text-sm">Appearance</span>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3">
          <SmartphoneIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div>
            <div className="font-medium">Keep it on your home screen</div>
            <p className="text-sm text-muted-foreground">
              In your browser menu, choose &ldquo;Add to Home screen&rdquo; (on iPhone: Share, then Add to Home Screen).
            </p>
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" size="lg" onClick={signOut} disabled={busy}>
        <LogOutIcon />
        Sign out
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Forgot your PIN? Ask your gym to send you a new link.
      </p>
    </div>
  );
}
