"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

type Snapshot = {
  /** Each item's distance from the top of the list before the update. */
  tops: Map<Element, number>;
  /** The control inside the list that had the focus before the update. */
  focused: HTMLElement | null;
};

/**
 * Keeps a keyed list steady while a live update changes its order: every item
 * glides from its previous place to the new one, and a focused control inside
 * a moved item keeps the focus. React reinserts the items it moves, which
 * would otherwise drop that focus.
 *
 * Attach `list` to the element whose children are the items and call
 * `capture()` just before each state update that may reorder them. `version`
 * is the state the list renders. Reduced motion skips the glide.
 */
export function useReorderedList<T extends HTMLElement>(version: unknown) {
  const list = useRef<T>(null);
  const before = useRef<Snapshot | null>(null);

  const capture = useCallback(() => {
    const container = list.current;
    if (!container) return;
    const tops = new Map<Element, number>();
    for (const item of container.children)
      if (item instanceof HTMLElement) tops.set(item, item.offsetTop);
    const active = document.activeElement;
    before.current = {
      tops,
      focused:
        active instanceof HTMLElement && container.contains(active)
          ? active
          : null,
    };
  }, []);

  useLayoutEffect(() => {
    const snapshot = before.current;
    before.current = null;
    const container = list.current;
    if (!snapshot || !container) return;
    // Only restore a focus the move took away, never one the guest moved.
    if (
      snapshot.focused?.isConnected &&
      document.activeElement === document.body
    )
      snapshot.focused.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const item of container.children) {
      const previous = snapshot.tops.get(item);
      if (previous === undefined || !(item instanceof HTMLElement)) continue;
      const distance = previous - item.offsetTop;
      if (distance !== 0)
        item.animate(
          [{ transform: `translateY(${distance}px)` }, { transform: "none" }],
          { duration: 320, easing: "cubic-bezier(0.3, 0, 0.1, 1)" },
        );
    }
  }, [version]);

  return { list, capture };
}
