"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import type { RoleCard, Werewolf } from "./contracts";
import type { SendCommand } from "./use-werewolf-game";
import { codePoints, messageLength, roleText } from "./werewolf-model";

/** The counter appears once this few characters are left. */
const counterMargin = 40;

/**
 * The viewer's own role. It stays out of the page until the player asks for
 * it, and leaves again on request or when the page is hidden, so a neighbour
 * glancing at the phone does not learn it.
 */
export function RoleReveal({ role }: { role: RoleCard }) {
  const { t } = useI18n();
  const id = useId();
  const [shown, setShown] = useState(false);
  const { name, description } = roleText(role, t);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) setShown(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  return (
    <section
      className="werewolf-role-card"
      aria-label={t("werewolf.myRole")}
      data-shown={shown || undefined}
    >
      {shown && (
        <div id={id}>
          <p className="werewolf-role-name">{name}</p>
          {description && <p className="werewolf-role-text">{description}</p>}
        </div>
      )}
      <button
        type="button"
        className={`button ${shown ? "secondary" : "primary"}`}
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        onClick={() => setShown(!shown)}
      >
        {shown ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
        {t(shown ? "werewolf.hideRole" : "werewolf.showRole")}
      </button>
    </section>
  );
}

/** The message a ghost drew for the mayor, shown to the mayor by day. */
export function MayorMessage({
  message,
}: {
  message: NonNullable<Werewolf["mayorMessage"]>;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <section className="werewolf-mayor-message" aria-labelledby={id}>
      <h2 id={id}>{t("werewolf.mayorMessageTitle")}</h2>
      <p className="werewolf-message-author">
        <Avatar name={message.from.name} avatarUrl={message.from.avatarUrl} />
        <strong>{message.from.name}</strong>
      </p>
      <p className="werewolf-message-text">{message.text}</p>
      <p className="fine-print">{t("werewolf.mayorMessagePrivacy")}</p>
    </section>
  );
}

/**
 * A dead player's message for the mayor, by night. Once sent it shows as
 * text, with the actions to replace or remove it until day comes.
 */
export function GhostMessage({
  saved,
  send,
}: {
  /** What the viewer wrote tonight, if anything. */
  saved: string | null;
  send: SendCommand;
}) {
  const { t } = useI18n();
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const [text, setText] = useState(saved ?? "");
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const length = codePoints(text);
  const writing = editing || saved === null;

  async function save(next: string) {
    if (sending) return;
    setSending(true);
    setError(null);
    setNotice("");
    try {
      await send("/message", "PUT", { text: next });
      setText(next);
      setEditing(false);
      setNotice(t(next ? "werewolf.messageSaved" : "werewolf.messageRemoved"));
      // The pressed button left with its view.
      section.current?.focus({ preventScroll: true });
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setSending(false);
    }
  }

  function submit(submission: FormEvent) {
    submission.preventDefault();
    if (length > 0 && length <= messageLength) void save(text.trim());
  }

  return (
    <section
      ref={section}
      className="werewolf-ghost"
      aria-labelledby={`${id}-label`}
      tabIndex={-1}
    >
      {writing ? (
        <form onSubmit={submit}>
          <label id={`${id}-label`} htmlFor={`${id}-text`}>
            {t("werewolf.messageLabel")}
          </label>
          {/* The field stays editable during a request, so a failure keeps
              the text and the keyboard. */}
          <textarea
            id={`${id}-text`}
            rows={3}
            value={text}
            autoFocus={editing}
            aria-describedby={`${id}-privacy ${id}-count`}
            aria-invalid={length > messageLength || undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          <p id={`${id}-count`} className="werewolf-counter">
            {length >= messageLength - counterMargin &&
              `${length} / ${messageLength}`}
          </p>
          <p id={`${id}-privacy`} className="fine-print">
            {t("werewolf.messagePrivacy")}
          </p>
          <ErrorNotice message={error} />
          <div className="werewolf-ghost-actions">
            <button
              className="button secondary"
              disabled={
                sending ||
                length === 0 ||
                length > messageLength ||
                text.trim() === saved
              }
            >
              {t("werewolf.sendMessage")}
            </button>
            {saved !== null && (
              <button
                type="button"
                className="button secondary"
                disabled={sending}
                onClick={() => {
                  setText(saved);
                  setEditing(false);
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <h2 id={`${id}-label`}>{t("werewolf.messageLabel")}</h2>
          <p className="werewolf-message-text">{saved}</p>
          <ErrorNotice message={error} />
          <div className="werewolf-ghost-actions">
            <button
              type="button"
              className="button secondary"
              disabled={sending}
              onClick={() => setEditing(true)}
            >
              {t("werewolf.editMessage")}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={sending}
              onClick={() => void save("")}
            >
              {t("werewolf.removeMessage")}
            </button>
          </div>
        </>
      )}
      <SavedAnnouncement message={notice} />
    </section>
  );
}
