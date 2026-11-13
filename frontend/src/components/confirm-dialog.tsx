"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n-context";
import "./confirm-dialog.css";

type ConfirmRequest = {
  /** A translated question that names the action and its consequence. */
  message: string;
  /** The action deletes or discards something. */
  destructive?: boolean;
};
type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

// The native dialog returns focus by itself, except to a control inside a
// menu that closed when focus left it; the menu's summary then stands in.
function restoreFocus(opener: Element | null) {
  if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
  opener.focus({ preventScroll: true });
  if (document.activeElement !== opener)
    opener
      .closest("details")
      ?.querySelector("summary")
      ?.focus({ preventScroll: true });
}

/**
 * Owns the single confirmation dialog of a page. The native modal dialog traps
 * focus, closes on Escape and returns focus to the control that opened it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const messageId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const answer = useRef<((confirmed: boolean) => void) | null>(null);
  const opener = useRef<Element | null>(null);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    // A second question replaces the first, which then counts as declined.
    if (answer.current) answer.current(false);
    else opener.current = document.activeElement;
    return new Promise((resolve) => {
      answer.current = resolve;
      setRequest(next);
    });
  }, []);

  useEffect(() => {
    const modal = dialog.current;
    if (!request || !modal || modal.open) return;
    modal.returnValue = "";
    // Cancel comes first in the document, so it receives the initial focus.
    modal.showModal();
  }, [request]);

  useEffect(
    () => () => {
      answer.current?.(false);
      answer.current = null;
    },
    [],
  );

  return (
    <ConfirmContext value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        role="alertdialog"
        aria-labelledby={messageId}
        onClose={(event) => {
          // Restore focus first so the caller can still move it afterwards.
          restoreFocus(opener.current);
          opener.current = null;
          // Escape and the backdrop leave the return value empty.
          answer.current?.(event.currentTarget.returnValue === "confirm");
          answer.current = null;
          setRequest(null);
        }}
        onClick={(event) => {
          // The form covers the whole box, so only the backdrop is a direct target.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <form method="dialog" className="confirm-dialog-content">
          <p id={messageId}>{request?.message}</p>
          <div className="confirm-dialog-actions">
            <button className="button secondary" value="cancel">
              {t("common.cancel")}
            </button>
            <button
              className={`button ${request?.destructive ? "confirm-dialog-danger" : "primary"}`}
              value="confirm"
            >
              {t("common.confirm")}
            </button>
          </div>
        </form>
      </dialog>
    </ConfirmContext>
  );
}

/** Asks the guest to confirm an action; resolves to false when they decline. */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("ConfirmProvider is required.");
  return confirm;
}
