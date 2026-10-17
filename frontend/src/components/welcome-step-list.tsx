"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { stepLabel, type StepDraft } from "./welcome-admin";

type Drag = {
  pointerId: number;
  handle: HTMLButtonElement;
  key: number;
  from: number;
  to: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  frame: number;
  order: string;
};

export function WelcomeStepList({
  steps,
  selectedKey,
  disabled,
  onSelect,
  onMove,
}: {
  steps: StepDraft[];
  selectedKey: number | null;
  disabled: boolean;
  onSelect: (key: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { t, locale } = useI18n();
  const list = useRef<HTMLOListElement>(null);
  const session = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<{
    key: number;
    from: number;
    to: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  function locate(current: Drag) {
    if (!list.current) return;
    let to = 0;
    for (const row of list.current.children) {
      if (
        !(row instanceof HTMLElement) ||
        Number(row.dataset.stepKey) === current.key
      )
        continue;
      const bounds = row.getBoundingClientRect();
      if (current.y > bounds.top + bounds.height / 2) to++;
    }
    if (to !== current.to) {
      current.to = to;
      setDrag({ key: current.key, from: current.from, to });
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
      if (navigation && getComputedStyle(navigation).position === "fixed") {
        bottom = Math.min(bottom, navigation.getBoundingClientRect().top);
      }
      if (
        bottom > top &&
        current.x >= bounds.left &&
        current.x <= bounds.right
      ) {
        if (current.y < top + 40) list.current.scrollTop -= 8;
        else if (current.y > bottom - 40) list.current.scrollTop += 8;
        locate(current);
      }
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
    const bounds = list.current?.getBoundingClientRect();
    const inside =
      bounds &&
      current.x >= bounds.left &&
      current.x <= bounds.right &&
      current.y >= bounds.top &&
      current.y <= bounds.bottom;
    if (commit && !disabled && inside) {
      onMove(current.from, current.to);
    } else {
      setAnnouncement(t("adminWelcome.dragCancelled"));
    }
    requestAnimationFrame(() => current.handle.focus({ preventScroll: true }));
  }

  const cancel = useEffectEvent(() => finish(false));

  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);

  useEffect(() => {
    const current = session.current;
    if (current && current.order !== steps.map((step) => step.key).join(","))
      cancel();
  }, [steps]);

  useEffect(() => {
    const interrupt = () => cancel();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", interrupt);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", interrupt);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(
    () => () => {
      if (session.current) cancelAnimationFrame(session.current.frame);
    },
    [],
  );

  function start(
    event: PointerEvent<HTMLButtonElement>,
    step: StepDraft,
    index: number,
  ) {
    if (disabled || !event.isPrimary || event.button !== 0 || session.current)
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      pointerId: event.pointerId,
      handle: event.currentTarget,
      key: step.key,
      from: index,
      to: index,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      frame: 0,
      order: steps.map((item) => item.key).join(","),
    };
    setAnnouncement("");
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
    if (!current.active && Math.abs(current.y - current.startY) >= 5) {
      current.active = true;
      setDrag({ key: current.key, from: current.from, to: current.to });
    }
    if (current.active) {
      event.preventDefault();
      locate(current);
    }
  }

  return (
    <>
      <ol
        className="welcome-step-list"
        ref={list}
        aria-label={t("adminWelcome.stepsTitle")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && session.current) {
            event.preventDefault();
            finish(false);
          }
        }}
      >
        {steps.map((step, index) => (
          <li
            key={step.key}
            data-step-key={step.key}
            data-selected={step.key === selectedKey || undefined}
            data-dragging={drag?.key === step.key || undefined}
            data-drop={
              drag && drag.to !== drag.from && drag.to === index
                ? drag.to < drag.from
                  ? "before"
                  : "after"
                : undefined
            }
          >
            <button
              type="button"
              className="welcome-drag-handle icon-button"
              disabled={disabled}
              aria-label={t("adminWelcome.drag", { number: number(index + 1) })}
              aria-describedby="welcome-reorder-hint"
              onPointerDown={(event) => start(event, step, index)}
              onPointerMove={move}
              onPointerUp={(event) => {
                if (session.current?.pointerId === event.pointerId)
                  finish(true);
              }}
              onPointerCancel={() => finish(false)}
              onLostPointerCapture={() => finish(false)}
            >
              <GripVertical size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="welcome-step-select"
              aria-label={t("adminWelcome.selectStep", {
                number: number(index + 1),
              })}
              aria-pressed={step.key === selectedKey}
              onClick={() => onSelect(step.key)}
            >
              <span className="welcome-list-number">{number(index + 1)}</span>
              <span className="welcome-list-copy">
                <strong>
                  {stepLabel(step).trim() ||
                    t("welcome.step", { number: number(index + 1) })}
                </strong>
                <span>
                  {t("widgets.count", { count: number(step.widgets.length) })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p id="welcome-reorder-hint" className="fine-print welcome-reorder-hint">
        {t("adminWelcome.reorderHint")}
      </p>
      <p className="welcome-announcement" role="status">
        {announcement}
      </p>
    </>
  );
}
