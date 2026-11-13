"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useI18n } from "@/lib/i18n-context";
import { moveItem } from "@/lib/reorder";
import { useLatestState } from "@/lib/use-latest-state";
import { useRouteRefresh } from "@/lib/use-route-refresh";
import { useConfirm } from "@/components/confirm-dialog";
import { ErrorNotice } from "@/components/ui";
import {
  adminInformationSchema,
  type AdminInformation,
  type InformationTab,
} from "./contracts";
import "./information-editor.css";

// Go enforces these limits; the editor only keeps the host within them.
const maxTabs = 8;
const maxTitleLength = 40;
const maxBodyLength = 4000;

/** A tab being typed; its key stays the same while tabs move. */
type TabDraft = InformationTab & { key: number };

function sameTabs(left: InformationTab[], right: InformationTab[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The host's editor of the information page. The switch and the tabs are saved
 * together, one request at a time, with the latest accepted revision. While a
 * tab has no title or no text, the tabs are not sent at all: only the switch
 * is, with the tabs as last saved, so an unfinished edit never unpublishes one.
 */
export function InformationEditor({
  initial,
  onSaved,
}: {
  initial: AdminInformation;
  /** Receives every accepted version, for the settings menu. */
  onSaved: (information: AdminInformation) => void;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const refreshRoute = useRouteRefresh();
  const id = useId();
  const list = useRef<HTMLOListElement>(null);
  // Queued saves read the revision and the switch after earlier ones finish.
  const [state, acceptState, currentState] = useLatestState(initial);
  const [enabled, setEnabled, currentEnabled] = useLatestState(initial.enabled);
  const [draft, setDraft] = useState<TabDraft[]>(() =>
    initial.tabs.map((tab, key) => ({ ...tab, key })),
  );
  const nextKey = useRef(initial.tabs.length);
  const [busy, setBusy] = useState<"reload" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");

  // Leaving a field and flipping the switch save without moving the focus.
  const quietSave = useRef(false);

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  // Local draft keys never leave the browser.
  const tabs = draft.map(({ title, body }) => ({
    title: title.trim(),
    body: body.trim(),
  }));
  const incompleteIndex = tabs.findIndex(({ title, body }) => !title || !body);
  const dirty = enabled !== state.enabled || !sameTabs(tabs, state.tabs);
  const locked = !!busy || conflict;
  const draftKept = notice === t("information.draftKept");
  const { flush, saving, onBlur } = useAutosave({ save });
  const structure = draft.map(({ key }) => key).join();
  const previousStructure = useRef(structure);

  // Adding, deleting and moving never blur a field, so they save here.
  useEffect(() => {
    if (previousStructure.current === structure) return;
    previousStructure.current = structure;
    if (dirty && incompleteIndex === -1 && !conflict) void flush();
  }, [structure, dirty, incompleteIndex, conflict, flush]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function fail(cause: unknown) {
    setError(errorMessage(cause, t));
    if (
      cause instanceof ApiError &&
      cause.code === "errors.information_conflict"
    )
      setConflict(true);
  }

  async function save() {
    const quiet = quietSave.current;
    quietSave.current = false;
    const saved = currentState();
    const complete = incompleteIndex === -1;
    // An unfinished tab holds every tab back; the switch goes with the tabs
    // as last saved.
    const next = {
      enabled: currentEnabled(),
      tabs: complete ? tabs : saved.tabs,
    };
    if (next.enabled !== saved.enabled || !sameTabs(next.tabs, saved.tabs)) {
      if (conflict) return false;
      setError(null);
      setNotice("");
      try {
        const updated = await api(
          "/admin/information",
          adminInformationSchema,
          { method: "PUT", body: { revision: saved.revision, ...next } },
        );
        // The host may have typed during the request: the draft stays as it
        // is and the next flush saves what is newer.
        acceptState(updated);
        onSaved(updated);
        if (complete) setNotice(t("information.saved"));
        // The dock of this page shows the tab once the page has content.
        refreshRoute();
      } catch (cause) {
        fail(cause);
        return false;
      }
    }
    if (complete) return true;
    // Leaving the page or retrying shows which tab holds the save back.
    if (!quiet)
      focusIn(
        draft[incompleteIndex].key,
        tabs[incompleteIndex].title ? "textarea" : "input",
      );
    return false;
  }

  async function reload(discard = false) {
    if (busy || saving) return;
    if (
      discard &&
      !(await confirm({
        message: t("information.discardConfirmation"),
        destructive: true,
      }))
    )
      return;
    setBusy(discard ? "discard" : "reload");
    setError(null);
    setNotice("");
    try {
      const updated = await api("/admin/information", adminInformationSchema);
      acceptState(updated);
      onSaved(updated);
      const keep = dirty && !discard;
      if (!keep) {
        setEnabled(updated.enabled);
        setDraft(
          updated.tabs.map((tab) => ({ ...tab, key: nextKey.current++ })),
        );
      }
      setConflict(false);
      setNotice(t(keep ? "information.draftKept" : "information.reloaded"));
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  }

  function toggle(next: boolean) {
    if (locked) return;
    setEnabled(next);
    quietSave.current = true;
    void flush();
  }

  function update(key: number, change: Partial<InformationTab>) {
    if (locked) return;
    setDraft((current) =>
      current.map((tab) => (tab.key === key ? { ...tab, ...change } : tab)),
    );
    setNotice("");
    setError(null);
  }

  /** Focuses a control of a tab once React has rendered the change. */
  function focusIn(key: number, ...selectors: string[]) {
    requestAnimationFrame(() => {
      const tab = list.current?.querySelector(`[data-tab-key="${key}"]`);
      for (const selector of selectors) {
        const control = tab?.querySelector<HTMLElement>(selector);
        if (control) return control.focus();
      }
    });
  }

  function add() {
    if (locked || draft.length >= maxTabs) return;
    const key = nextKey.current++;
    setDraft((current) => [...current, { key, title: "", body: "" }]);
    focusIn(key, "input");
  }

  function move(from: number, to: number, direction: "up" | "down") {
    if (locked) return;
    const { key } = draft[from];
    setDraft(moveItem(draft, from, to));
    setAnnouncement(
      t("information.moved", { from: number(from + 1), to: number(to + 1) }),
    );
    // The pressed button is disabled once the tab reaches an end of the list.
    focusIn(
      key,
      `[data-move="${direction}"]:not(:disabled)`,
      "[data-move]:not(:disabled)",
    );
  }

  async function remove(index: number) {
    if (locked) return;
    const tab = draft[index];
    // An empty tab has nothing to lose.
    if (
      (tab.title.trim() || tab.body.trim()) &&
      !(await confirm({
        message: t("information.removeConfirmation", {
          number: number(index + 1),
        }),
        destructive: true,
      }))
    )
      return;
    const next = draft[index + 1] ?? draft[index - 1];
    setDraft((current) => current.filter((item) => item.key !== tab.key));
    setAnnouncement(t("information.removed", { number: number(index + 1) }));
    if (next) focusIn(next.key, "input");
    else
      requestAnimationFrame(() =>
        document.getElementById(`${id}-add`)?.focus(),
      );
  }

  return (
    <section
      className="information-editor"
      aria-label={t("page.information")}
      aria-busy={!!busy || saving}
      data-dirty={dirty || undefined}
    >
      <form
        noValidate
        onBlur={(event) => {
          if (event.target.matches("input, textarea")) quietSave.current = true;
          onBlur(event);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <p className="muted information-editor-intro">
          {t("information.intro")}
        </p>
        <div className="information-switch">
          <label className="checkbox-field">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={locked}
              aria-describedby={`${id}-switch-hint`}
              onChange={(event) => toggle(event.target.checked)}
            />
            {t("information.enabled")}
          </label>
          <p id={`${id}-switch-hint`} className="fine-print">
            {t(
              enabled && state.tabs.length === 0
                ? "information.noTabs"
                : "information.enabledHint",
            )}
          </p>
        </div>

        <ol className="information-tab-list" ref={list}>
          {draft.map((tab, index) => {
            const position = { number: number(index + 1) };
            const { title, body } = tabs[index];
            const fieldId = `${id}-${tab.key}`;
            const incomplete = !title || !body;
            return (
              <li key={tab.key} data-tab-key={tab.key}>
                <div className="information-tab-toolbar">
                  <h3>{t("information.tab", position)}</h3>
                  <div className="information-tab-controls">
                    <button
                      type="button"
                      className="icon-button"
                      data-move="up"
                      disabled={locked || index === 0}
                      aria-label={t("information.moveUp", position)}
                      onClick={() => move(index, index - 1, "up")}
                    >
                      <ArrowUp size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      data-move="down"
                      disabled={locked || index === draft.length - 1}
                      aria-label={t("information.moveDown", position)}
                      onClick={() => move(index, index + 1, "down")}
                    >
                      <ArrowDown size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      disabled={locked}
                      aria-label={t("information.remove", position)}
                      onClick={() => void remove(index)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <label htmlFor={`${fieldId}-title`}>
                  {t("information.tabTitle", position)}
                </label>
                <input
                  id={`${fieldId}-title`}
                  value={tab.title}
                  maxLength={maxTitleLength}
                  disabled={locked}
                  aria-describedby={incomplete ? `${fieldId}-hint` : undefined}
                  onChange={(event) =>
                    update(tab.key, { title: event.target.value })
                  }
                />
                <label htmlFor={`${fieldId}-body`}>
                  {t("information.tabBody", position)}
                </label>
                <textarea
                  id={`${fieldId}-body`}
                  rows={7}
                  value={tab.body}
                  maxLength={maxBodyLength}
                  disabled={locked}
                  aria-describedby={incomplete ? `${fieldId}-hint` : undefined}
                  onChange={(event) =>
                    update(tab.key, { body: event.target.value })
                  }
                />
                {incomplete && (
                  <p
                    id={`${fieldId}-hint`}
                    className="information-tab-hint"
                    data-partial={!!(title || body) || undefined}
                  >
                    {t("information.incomplete")}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <p className="visually-hidden" role="status">
          {announcement}
        </p>

        <button
          type="button"
          id={`${id}-add`}
          className="button secondary"
          disabled={locked || draft.length >= maxTabs}
          onClick={add}
        >
          <Plus size={17} aria-hidden="true" />
          {t("information.add")}
        </button>
        {draft.length >= maxTabs && (
          <p className="fine-print information-limit">
            {t("information.limit", { count: number(maxTabs) })}
          </p>
        )}

        <p className="information-notice" role="status">
          {saving ? t("admin.saving") : notice}
        </p>
        <ErrorNotice message={error} />
        {(conflict || (dirty && (error || draftKept))) && (
          <div className="form-actions">
            {conflict ? (
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || saving}
                onClick={() => void reload()}
              >
                <RefreshCw size={17} aria-hidden="true" />
                {t(
                  busy === "reload"
                    ? "information.reloading"
                    : "information.reload",
                )}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy || saving}
                  onClick={() => void flush()}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                  {t("common.retry")}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={!!busy || saving}
                  onClick={() => void reload(true)}
                >
                  <X size={17} aria-hidden="true" />
                  {t(
                    busy === "discard"
                      ? "information.reloading"
                      : "information.discard",
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
