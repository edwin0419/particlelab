"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { ko } from "@/i18n/ko";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sem-theme";

type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn("gap-2", className)}
      aria-label={ko.theme.toggle}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{theme === "dark" ? ko.theme.light : ko.theme.dark}</span>
    </Button>
  );
}
