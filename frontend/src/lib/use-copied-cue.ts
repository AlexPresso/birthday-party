"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const cueDuration = 2000;

/**
 * Remembers what was just copied for two seconds, so the button that copied it
 * can confirm with its own label and icon instead of a separate message.
 * `mark(null)` withdraws the cue at once.
 */
export function useCopiedCue<T>() {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const mark = useCallback((value: T | null) => {
    window.clearTimeout(timer.current);
    setCopied(value);
    if (value !== null)
      timer.current = window.setTimeout(() => setCopied(null), cueDuration);
  }, []);

  return [copied, mark] as const;
}
