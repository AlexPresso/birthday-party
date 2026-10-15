"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { welcomeSchema, type Welcome } from "./contracts";

// One small request per visible browser every three seconds is enough for a
// host-led welcome. Hidden tabs pause and refresh as soon as guests return.
export function useWelcome(initial: Welcome | null = null) {
  const [welcome, setWelcome] = useState(initial);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    async function poll() {
      clearTimeout(timer);
      if (disposed || pending || document.hidden) return;
      pending = true;
      const controller = new AbortController();
      request = controller;
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const next = await api("/welcome", welcomeSchema, {
          signal: controller.signal,
        });
        if (!disposed) {
          setWelcome((previous) =>
            previous?.revision === next.revision ? previous : next,
          );
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (!disposed && !document.hidden) timer = setTimeout(poll, 3000);
      }
    }

    retry.current = poll;
    void poll();
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    return () => {
      disposed = true;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
    };
  }, []);

  return { welcome, failed, refresh: () => retry.current() };
}
