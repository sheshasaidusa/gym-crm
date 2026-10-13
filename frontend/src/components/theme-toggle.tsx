"use client"

import * as React from "react"
import { IconMoon, IconSun } from "@tabler/icons-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

// From gray-ui-csm by Jason-uxui (MIT).

import { Button } from "@/components/ui/button"

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={cn("size-9 rounded-full p-0", className)}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </Button>
  )
}
