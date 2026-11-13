"use client";

import { useCallback, useRef, useState } from "react";

/**
 * State that asynchronous handlers also read in its latest version. A queued
 * save continues after an await, when the values captured by its render are
 * stale; `get` returns what `set` stored last, before the next render.
 */
export function useLatestState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const set = useCallback((next: T) => {
    latest.current = next;
    setValue(next);
  }, []);
  const get = useCallback(() => latest.current, []);
  return [value, set, get] as const;
}
