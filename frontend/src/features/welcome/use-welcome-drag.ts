"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

/** A row of the list being reordered, or a new item dragged in from outside. */
export type DragSource<New = never> =
  { type: "new"; item: New } | { type: "existing"; key: number; from: number };

type Session<New> = {
  source: DragSource<New>;
  pointerId: number;
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  to: number | null;
  frame: number;
  order: string;
};

/**
 * Pointer dragging for the welcome editor's ordered lists, from a dedicated
 * handle so scrolling and text selection keep working elsewhere. A drop commits
 * only inside the list; Escape, a disabled editor, a hidden page or a change to
 * the rows cancels the drag without touching the draft.
 *
 * `to` is the final position among the other rows, or null outside the list.
 */
export function useWelcomeDrag<New = never>({
  list,
  keys,
  rowKey,
  disabled,
  scrollPage = false,
  onStart,
  onAdd,
  onMove,
  onCancel,
}: {
  list: RefObject<HTMLOListElement | null>;
  /** Row keys in their current order. */
  keys: number[];
  /** The `data-*` attribute, in dataset form, that carries each row's key. */
  rowKey: "stepKey" | "widgetKey";
  disabled: boolean;
  /** Also scroll the page near its edges, for a source stacked above the list. */
  scrollPage?: boolean;
  onStart?: () => void;
  onAdd?: (item: New, to: number) => void;
  onMove: (from: number, to: number) => void;
  onCancel: () => void;
}) {
  const session = useRef<Session<New> | null>(null);
  const [drag, setDrag] = useState<{
    source: DragSource<New>;
    to: number | null;
  } | null>(null);
  const order = keys.join(",");

  function locate(current: Session<New>) {
    if (!list.current) return;
    const bounds = list.current.getBoundingClientRect();
    const inside =
      current.x >= bounds.left &&
      current.x <= bounds.right &&
      current.y >= bounds.top &&
      current.y <= bounds.bottom;
    let to: number | null = null;
    if (inside) {
      to = 0;
      for (const row of list.current.children) {
        if (
          !(row instanceof HTMLElement) ||
          !row.dataset[rowKey] ||
          (current.source.type === "existing" &&
            Number(row.dataset[rowKey]) === current.source.key)
        )
          continue;
        const rect = row.getBoundingClientRect();
        if (current.y > rect.top + rect.height / 2) to++;
      }
    }
    if (to !== current.to) {
      current.to = to;
      setDrag({ source: current.source, to });
    }
  }

  function scroll() {
    const current = session.current;
    if (!current || !list.current) return;
    if (current.active) {
      const bounds = list.current.getBoundingClientRect();
      const top = Math.max(bounds.top, 0);
      let bottom = Math.min(bounds.bottom, window.innerHeight);
      const navigation = document.querySelector<HTMLElement>(".navigation");
      if (navigation && getComputedStyle(navigation).position === "fixed")
        bottom = Math.min(bottom, navigation.getBoundingClientRect().top);
      if (
        bottom > top &&
        current.x >= bounds.left &&
        current.x <= bounds.right
      ) {
        if (current.y >= top && current.y < top + 40)
          list.current.scrollTop -= 9;
        else if (current.y <= bottom && current.y > bottom - 40)
          list.current.scrollTop += 9;
      }
      if (scrollPage) {
        if (current.y < 55) window.scrollBy(0, -9);
        else if (current.y > bottom && current.y > window.innerHeight - 110)
          window.scrollBy(0, 9);
      }
      locate(current);
    }
    current.frame = requestAnimationFrame(scroll);
  }

  function finish(commit: boolean) {
    const current = session.current;
    if (!current) return;
    session.current = null;
    cancelAnimationFrame(current.frame);
    if (current.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    setDrag(null);
    if (!current.active) return;
    const { source, to, handle } = current;
    const restoreFocus = () =>
      requestAnimationFrame(() => handle.focus({ preventScroll: true }));
    if (!commit || disabled || to === null) {
      onCancel();
      restoreFocus();
    } else if (source.type === "new") {
      // The owner focuses the row it creates.
      onAdd?.(source.item, to);
    } else {
      if (to !== source.from) onMove(source.from, to);
      restoreFocus();
    }
  }

  const cancel = useEffectEvent(() => finish(false));
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  useEffect(() => {
    if (session.current && session.current.order !== order) cancel();
  }, [order]);
  useEffect(() => {
    const interrupt = () => cancel();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("blur", interrupt);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
      if (session.current) cancelAnimationFrame(session.current.frame);
    };
  }, []);

  function start(
    event: PointerEvent<HTMLButtonElement>,
    source: DragSource<New>,
  ) {
    if (disabled || !event.isPrimary || event.button !== 0 || session.current)
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      source,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      to: null,
      frame: 0,
      order,
    };
    onStart?.();
    session.current.frame = requestAnimationFrame(scroll);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (disabled) {
      finish(false);
      return;
    }
    current.x = event.clientX;
    current.y = event.clientY;
    if (
      !current.active &&
      Math.hypot(current.x - current.startX, current.y - current.startY) >= 5
    ) {
      current.active = true;
      setDrag({ source: current.source, to: current.to });
    }
    if (current.active) {
      event.preventDefault();
      locate(current);
    }
  }

  /** Pointer handlers for one drag handle. */
  function bindings(source: DragSource<New>) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) =>
        start(event, source),
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        if (session.current?.pointerId === event.pointerId) finish(true);
      },
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
    };
  }
  return { drag, bindings };
}
