"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { welcomeSchema, type Welcome } from "./contracts";
import { latestWelcome } from "./welcome-state";
import { createInvalidationRefresh } from "./invalidation-refresh";
import { retryRealtime, subscribeRealtime } from "./realtime-browser";

export function useWelcome(initial: Welcome | null = null) {
  const [welcome, setWelcome] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    const refresh = createInvalidationRefresh(
      async (signal) => {
        const next = await api("/welcome", welcomeSchema, {
          signal,
        });
        signal.throwIfAborted();
        setWelcome((previous) => latestWelcome(previous, next));
        setFailed(false);
      },
      () => setFailed(true),
    );
    retry.current = () => {
      retryRealtime();
      void refresh.request();
    };
    const unsubscribe = subscribeRealtime(
      "welcome",
      () => void refresh.request(),
      (connected) => setConnectionFailed(!connected),
    );
    return () => {
      retry.current = () => {};
      unsubscribe();
      refresh.dispose();
    };
  }, []);

  return {
    welcome,
    failed: failed || connectionFailed,
    refresh: () => retry.current(),
    accept: (next: Welcome) => {
      setWelcome((previous) => latestWelcome(previous, next));
      setFailed(false);
    },
  };
}
