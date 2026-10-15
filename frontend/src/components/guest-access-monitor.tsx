"use client";

import { useEffect } from "react";
import { returnToWelcome } from "@/lib/api";
import { useWelcome } from "@/lib/use-welcome";

export function GuestAccessMonitor() {
  const { welcome } = useWelcome();
  useEffect(() => {
    if (welcome && !welcome.open) returnToWelcome();
  }, [welcome]);
  return null;
}
