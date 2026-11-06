"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { ErrorNotice } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import type { QuestionRound } from "./contracts";

export function QuestionComposer({
  status,
  full,
  busy,
  error,
  onSend,
  children,
}: {
  status: QuestionRound["status"];
  full: boolean;
  busy: boolean;
  error: string | null;
  onSend: (body: string) => Promise<boolean>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const available = status === "open" && !full;

  useEffect(() => {
    if (!sheetOpen) return;
    const modal = dialog.current!;
    const desktopForm = desktop.current;
    const launchButton = trigger.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    modal.querySelector("textarea")?.focus();
    const breakpoint = window.matchMedia("(min-width: 960px)");
    const resize = () => {
      if (breakpoint.matches) setSheetOpen(false);
    };
    breakpoint.addEventListener("change", resize);
    return () => {
      breakpoint.removeEventListener("change", resize);
      modal.close();
      document.body.style.overflow = overflow;
      if (breakpoint.matches)
        desktopForm?.querySelector("textarea")?.focus({ preventScroll: true });
      else launchButton?.focus({ preventScroll: true });
    };
  }, [sheetOpen]);

  async function submit() {
    if (busy || sending || !available || !body.trim()) return;
    setSending(true);
    try {
      if (await onSend(body.trim())) {
        setBody("");
        setSheetOpen(false);
      }
    } finally {
      setSending(false);
    }
  }

  const formProps = {
    body,
    setBody,
    disabled: busy || !available,
    sending,
    submit,
    explanation: full
      ? t("errors.question_limit_reached")
      : status !== "open"
        ? t("questions.closed")
        : null,
  };

  return (
    <aside className="question-sidebar">
      {status === "open" && (
        <>
          <button
            ref={trigger}
            type="button"
            className="button primary question-compose-trigger"
            disabled={!available}
            onClick={() => setSheetOpen(true)}
          >
            <Plus size={21} aria-hidden="true" />
            {t("questions.compose")}
          </button>
          {full && (
            <p className="question-mobile-limit muted">
              {t("errors.question_limit_reached")}
            </p>
          )}
          <div ref={desktop} className="question-desktop-compose">
            <QuestionForm {...formProps} />
          </div>
        </>
      )}
      {children}
      {sheetOpen && (
        <dialog
          ref={dialog}
          className="question-sheet"
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            setSheetOpen(false);
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setSheetOpen(false);
          }}
        >
          <div className="question-sheet-heading">
            <h2 id={titleId}>{t("questions.compose")}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t("questions.dismiss")}
              onClick={() => setSheetOpen(false)}
            >
              <X size={23} aria-hidden="true" />
            </button>
          </div>
          <ErrorNotice message={error} />
          <QuestionForm {...formProps} />
        </dialog>
      )}
    </aside>
  );
}

function QuestionForm({
  body,
  setBody,
  disabled,
  sending,
  submit,
  explanation,
}: {
  body: string;
  setBody: (body: string) => void;
  disabled: boolean;
  sending: boolean;
  submit: () => Promise<void>;
  explanation: string | null;
}) {
  const { t } = useI18n();
  const inputId = useId();
  return (
    <form
      className="question-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={inputId}>{t("questions.ask")}</label>
      <textarea
        id={inputId}
        required
        maxLength={1000}
        rows={6}
        value={body}
        disabled={disabled}
        placeholder={t("questions.placeholder")}
        aria-describedby={`${inputId}-privacy`}
        onChange={(event) => setBody(event.target.value)}
      />
      <p id={`${inputId}-privacy`} className="fine-print">
        {t("questions.privacy")}
      </p>
      {explanation && (
        <p className="muted" role="status">
          {explanation}
        </p>
      )}
      <button
        className="button primary"
        disabled={disabled || sending || !body.trim()}
      >
        {t(sending ? "questions.sending" : "questions.send")}
      </button>
    </form>
  );
}
