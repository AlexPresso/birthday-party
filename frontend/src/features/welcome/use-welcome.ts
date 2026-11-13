"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import { welcomeSchema, type Welcome } from "./contracts";
import { latestWelcome } from "./welcome-state";

export function useWelcome(initial: Welcome | null = null) {
  const [welcome, setWelcome] = useState(initial);
  const [failed, setFailed] = useState(false);
  const { connectionFailed, retry } = useRealtimeResource({
    topic: "welcome",
    hasInitialData: initial !== null,
    async read(signal) {
      const next = await api("/welcome", welcomeSchema, { signal });
      signal.throwIfAborted();
      setWelcome((previous) => latestWelcome(previous, next));
      setFailed(false);
    },
    onError: () => setFailed(true),
  });

  return {
    welcome,
    failed: failed || connectionFailed,
    refresh: () => void retry(),
    accept: (next: Welcome) => {
      setWelcome((previous) => latestWelcome(previous, next));
      setFailed(false);
    },
  };
}
