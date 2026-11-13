"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Refreshes the server-rendered route, one refresh at a time. Two refreshes
 * that overlap leave the Next.js router in a state where it drops the next tab
 * change and can remount the page, losing what is being typed. A refresh asked
 * for while another is rendering therefore runs once that one has finished.
 */
export function useRouteRefresh() {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  const running = useRef(false);
  const queued = useRef(false);

  const refresh = useCallback(() => {
    if (running.current) {
      queued.current = true;
      return;
    }
    running.current = true;
    startRefresh(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (pending || !running.current) return;
    running.current = false;
    if (queued.current) {
      queued.current = false;
      refresh();
    }
  }, [pending, refresh]);

  return refresh;
}
