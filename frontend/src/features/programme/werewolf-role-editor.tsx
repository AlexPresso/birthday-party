"use client";

import { useId, useRef, useState } from "react";
import { Minus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useI18n } from "@/lib/i18n-context";
import { useLatestState } from "@/lib/use-latest-state";
import type { WerewolfRole } from "./contracts";
import type { SendCommand } from "./use-werewolf-game";
import {
  mergeSavedRoles,
  quantityLimit,
  roleDescriptionLength,
  roleDrafts,
  roleInputs,
  roleLimit,
  roleNameLength,
  roleText,
  roleTotal,
  sameRoleInputs,
  unnamedRole,
  type RoleDraft,
} from "./werewolf-model";

/**
 * The game master's role list. It shows the saved roles until a row changes,
 * then keeps that draft and saves it by itself: at once for a quantity, an
 * added or a deleted role, when a field loses focus for typed text. Saves go
 * one at a time; a failed one keeps the draft, a conflict reloads the list.
 */
export function useRoleEditor(roles: WerewolfRole[], send: SendCommand) {
  const { t } = useI18n();
  const [draft, setDraft, latestDraft] = useLatestState<RoleDraft[] | null>(
    null,
  );
  // The row of each saved role, so a saved custom role keeps its fields.
  const [rowKeys, setRowKeys] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [nameRequired, setNameRequired] = useState(false);
  const savedRows = roleDrafts(roles, rowKeys);
  const { flush, saving, onBlur } = useAutosave({ save });

  async function save(): Promise<boolean> {
    const submitted = latestDraft();
    if (!submitted) return true;
    setError(null);
    setNotice("");
    const inputs = roleInputs(submitted, t);
    if (sameRoleInputs(inputs, roleInputs(savedRows, t))) {
      setDraft(null);
      return true;
    }
    // A role without a name is held back with the rest, never sent or dropped.
    if (unnamedRole(submitted)) {
      setNameRequired(true);
      return false;
    }
    try {
      const game = await send("/roles", "PUT", (revision) => ({
        revision,
        roles: inputs,
      }));
      const saved = game.roles ?? [];
      setRowKeys((keys) => {
        const next = new Map(keys);
        submitted.forEach((row, index) => {
          if (saved[index]) next.set(saved[index].id, row.rowKey);
        });
        return next;
      });
      const merged = mergeSavedRoles(latestDraft() ?? [], submitted, saved);
      const settled = sameRoleInputs(
        roleInputs(merged, t),
        roleInputs(roleDrafts(saved), t),
      );
      setDraft(settled ? null : merged);
      if (settled) setNotice(t("werewolf.rolesSaved"));
      return true;
    } catch (cause) {
      // Still refused with the current revision: the game itself changed
      // elsewhere, and the reload that follows shows its roles.
      if (cause instanceof ApiError && cause.status === 409) setDraft(null);
      setError(errorMessage(cause, t));
      return false;
    }
  }

  return {
    /** The rows to show: the draft, or the saved roles. */
    rows: draft ?? savedRows,
    dirty: draft !== null,
    saving,
    error,
    notice,
    nameRequired,
    flush,
    onBlur,
    /** `commit` saves at once, for controls that never blur. */
    change(rows: RoleDraft[], commit = false) {
      setDraft(rows);
      setNotice("");
      if (!unnamedRole(rows)) setNameRequired(false);
      if (commit) void flush();
    },
  };
}

type RoleEditorState = ReturnType<typeof useRoleEditor>;

export function RoleEditor({ editor }: { editor: RoleEditorState }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const id = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const added = useRef(0);
  // The row whose fields are open, and whether it was just added.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [focusName, setFocusName] = useState(false);
  const { rows } = editor;
  const full = rows.length >= roleLimit;

  function edit(row: RoleDraft, changes: Partial<RoleDraft>, commit = false) {
    editor.change(
      rows.map((current) =>
        current.rowKey === row.rowKey ? { ...current, ...changes } : current,
      ),
      commit,
    );
  }

  function add() {
    const rowKey = `new-${++added.current}`;
    setOpenRow(rowKey);
    setFocusName(true);
    editor.change([
      ...rows,
      { rowKey, id: null, key: null, name: "", description: "", count: 1 },
    ]);
  }

  async function remove(row: RoleDraft) {
    const name = row.name.trim();
    if (
      (name || row.description?.trim()) &&
      !(await confirm({
        message: t("werewolf.deleteRoleConfirm", {
          name: name || t("werewolf.newRole"),
        }),
        destructive: true,
      }))
    )
      return;
    editor.change(
      rows.filter((current) => current.rowKey !== row.rowKey),
      true,
    );
    // The row's button is gone; the next action is usually another role.
    addButton.current?.focus();
  }

  return (
    <section
      className="werewolf-section werewolf-roles"
      aria-labelledby={`${id}-title`}
      aria-busy={editor.saving}
      data-dirty={editor.dirty || undefined}
      onBlur={editor.onBlur}
    >
      <div className="werewolf-list-heading">
        <h2 id={`${id}-title`}>{t("werewolf.rolesTitle")}</h2>
        <span>{new Intl.NumberFormat(locale).format(roleTotal(rows))}</span>
      </div>
      <ul className="werewolf-role-list">
        {rows.map((row) => {
          const open = openRow === row.rowKey;
          const fieldId = `${id}-${row.rowKey}`;
          const name =
            row.key === null
              ? row.name.trim() || t("werewolf.newRole")
              : roleText(row, t).name;
          const original =
            row.key === null ? "" : t(`werewolf.roleText.${row.key}`);
          const rewritten =
            row.key !== null &&
            row.description !== null &&
            row.description.trim() !== original;
          return (
            <li key={row.rowKey} className="werewolf-role">
              <div
                className="werewolf-role-line"
                role="group"
                aria-label={name}
              >
                <span className="werewolf-role-title">{name}</span>
                <span className="werewolf-stepper">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("werewolf.fewer", { name })}
                    aria-disabled={row.count <= 0}
                    onClick={() => {
                      if (row.count > 0)
                        edit(row, { count: row.count - 1 }, true);
                    }}
                  >
                    <Minus size={18} aria-hidden="true" />
                  </button>
                  <span className="werewolf-quantity" aria-live="polite">
                    {new Intl.NumberFormat(locale).format(row.count)}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("werewolf.more", { name })}
                    aria-disabled={row.count >= quantityLimit}
                    onClick={() => {
                      if (row.count < quantityLimit)
                        edit(row, { count: row.count + 1 }, true);
                    }}
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("werewolf.editRole", { name })}
                  aria-expanded={open}
                  aria-controls={open ? `${fieldId}-fields` : undefined}
                  onClick={() => {
                    setFocusName(false);
                    setOpenRow(open ? null : row.rowKey);
                  }}
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
              </div>
              {open && (
                <div id={`${fieldId}-fields`} className="werewolf-role-fields">
                  {row.key === null && (
                    <>
                      <label htmlFor={`${fieldId}-name`}>
                        {t("werewolf.roleName")}
                      </label>
                      <input
                        id={`${fieldId}-name`}
                        value={row.name}
                        maxLength={roleNameLength}
                        autoComplete="off"
                        autoFocus={focusName}
                        aria-invalid={
                          (editor.nameRequired && !row.name.trim()) || undefined
                        }
                        aria-describedby={`${fieldId}-name-error`}
                        onChange={(event) =>
                          edit(row, { name: event.target.value })
                        }
                      />
                      <p
                        id={`${fieldId}-name-error`}
                        className="werewolf-field-error"
                        role="status"
                      >
                        {editor.nameRequired && !row.name.trim()
                          ? t("werewolf.roleNameRequired")
                          : ""}
                      </p>
                    </>
                  )}
                  <label htmlFor={`${fieldId}-description`}>
                    {t("werewolf.roleDescription")}
                  </label>
                  <textarea
                    id={`${fieldId}-description`}
                    rows={4}
                    maxLength={roleDescriptionLength}
                    value={row.description ?? original}
                    onChange={(event) =>
                      edit(row, { description: event.target.value })
                    }
                  />
                  {rewritten && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => edit(row, { description: null }, true)}
                    >
                      {t("werewolf.restoreDescription")}
                    </button>
                  )}
                  {row.key === null && (
                    <button
                      type="button"
                      className="text-button werewolf-danger"
                      onClick={() => void remove(row)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                      {t("werewolf.deleteRole")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="werewolf-roles-footer">
        <button
          ref={addButton}
          type="button"
          className="text-button"
          disabled={full}
          onClick={add}
        >
          <Plus size={17} aria-hidden="true" />
          {t("werewolf.addRole")}
        </button>
        <p className="status-notice" role="status">
          {editor.saving ? t("activities.saving") : ""}
        </p>
      </div>
      {full && <p className="fine-print">{t("werewolf.roleLimit")}</p>}
      <SavedAnnouncement message={editor.saving ? "" : editor.notice} />
      <ErrorNotice message={editor.error} />
      {editor.error && editor.dirty && (
        <button
          type="button"
          className="button secondary"
          disabled={editor.saving}
          onClick={() => void editor.flush()}
        >
          <RefreshCw size={17} aria-hidden="true" />
          {t("common.retry")}
        </button>
      )}
    </section>
  );
}
