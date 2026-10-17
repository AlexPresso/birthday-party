"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { WelcomeWidget } from "./contracts";
import type { WidgetDraft } from "./editor-model";

type Source =
  | { type: "new"; widgetType: WelcomeWidget["type"] }
  | { type: "existing"; key: number; from: number };
type Session = {
  source: Source;
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

export function useWelcomeWidgetDrag({
  list,
  widgets,
  disabled,
  onAdd,
  onMove,
  onCancel,
}: {
  list: RefObject<HTMLOListElement | null>;
  widgets: WidgetDraft[];
  disabled: boolean;
  onAdd: (type: WelcomeWidget["type"], to: number) => void;
  onMove: (from: number, to: number) => void;
  onCancel: () => void;
}) {
  const session = useRef<Session | null>(null);
  const [drag, setDrag] = useState<{
    source: Source;
    to: number | null;
  } | null>(null);

  function locate(current: Session) {
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
          !row.dataset.widgetKey ||
          (current.source.type === "existing" &&
            Number(row.dataset.widgetKey) === current.source.key)
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
      // The palette and canvas can be stacked on a phone, so allow dragging across the page.
      if (current.y < 55) window.scrollBy(0, -9);
      else if (current.y > bottom && current.y > window.innerHeight - 110)
        window.scrollBy(0, 9);
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
    if (commit && !disabled && current.to !== null) {
      if (current.source.type === "new")
        onAdd(current.source.widgetType, current.to);
      else {
        onMove(current.source.from, current.to);
        requestAnimationFrame(() =>
          current.handle.focus({ preventScroll: true }),
        );
      }
    } else {
      onCancel();
      requestAnimationFrame(() =>
        current.handle.focus({ preventScroll: true }),
      );
    }
  }

  const cancel = useEffectEvent(() => finish(false));
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  useEffect(() => {
    if (
      session.current &&
      session.current.order !== widgets.map((widget) => widget.key).join(",")
    )
      cancel();
  }, [widgets]);
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

  function start(event: PointerEvent<HTMLButtonElement>, source: Source) {
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
      order: widgets.map((widget) => widget.key).join(","),
    };
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

  function bindings(source: Source) {
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
