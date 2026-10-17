"use client";

import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Bell,
  GripVertical,
  Images,
  Plus,
  Trash2,
  Type,
  AlignLeft,
} from "lucide-react";
import type { MediaCategory } from "@/features/media/contracts";
import type { WelcomeWidget } from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import { moveItem } from "@/lib/reorder";
import type { StepDraft, WidgetDraft } from "./editor-model";
import { useWelcomeWidgetDrag } from "./use-welcome-widget-drag";
import "./welcome-widget-editor.css";

const types = [
  "title",
  "text",
  "profile_photo",
  "media_upload",
  "enable_notifications",
] as const;
const labels = {
  title: "widgets.title",
  text: "widgets.text",
  profile_photo: "widgets.profilePhoto",
  media_upload: "widgets.mediaUpload",
  enable_notifications: "notifications.widget",
} as const;
const icons = {
  title: Type,
  text: AlignLeft,
  profile_photo: Camera,
  media_upload: Images,
  enable_notifications: Bell,
};

export function focusWidget(key: number) {
  const row = document.querySelector<HTMLElement>(`[data-widget-key="${key}"]`);
  (
    row?.querySelector<HTMLElement>("input, textarea, select") ??
    row?.querySelector<HTMLElement>(".welcome-widget-drag")
  )?.focus();
}

export function WelcomeWidgetEditor({
  step,
  disabled,
  categories,
  onChange,
  createKey,
}: {
  step: StepDraft;
  disabled: boolean;
  categories: MediaCategory[];
  onChange: (widgets: WidgetDraft[]) => void;
  createKey: () => number;
}) {
  const { t, locale } = useI18n();
  const list = useRef<HTMLOListElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  function canAdd(type: WelcomeWidget["type"]) {
    return (
      !disabled &&
      step.widgets.length < 12 &&
      !(
        (type === "profile_photo" || type === "enable_notifications") &&
        step.widgets.some((widget) => widget.type === type)
      )
    );
  }
  function add(type: WelcomeWidget["type"], index: number) {
    if (!canAdd(type)) return;
    const key = createKey();
    const widget: WidgetDraft =
      type === "title" || type === "text"
        ? { key, type, text: "" }
        : type === "media_upload"
          ? { key, type, mediaUpload: { categoryId: null } }
          : { key, type };
    const updated = [...step.widgets];
    updated.splice(index, 0, widget);
    onChange(updated);
    setAnnouncement(
      t("widgets.added", { name: t(labels[type]), number: number(index + 1) }),
    );
    requestAnimationFrame(() => focusWidget(key));
  }
  function move(from: number, to: number) {
    if (disabled || from === to) return;
    onChange(moveItem(step.widgets, from, to));
    setAnnouncement(
      t("widgets.moved", { from: number(from + 1), to: number(to + 1) }),
    );
  }
  function moveWithButton(from: number, to: number, button: HTMLButtonElement) {
    const key = step.widgets[from].key;
    move(from, to);
    requestAnimationFrame(() => {
      if (button.disabled)
        document
          .querySelector<HTMLButtonElement>(
            `[data-widget-key="${key}"] .welcome-widget-drag`,
          )
          ?.focus();
    });
  }
  function update(updated: WidgetDraft) {
    if (!disabled)
      onChange(
        step.widgets.map((widget) =>
          widget.key === updated.key ? updated : widget,
        ),
      );
  }
  function remove(index: number) {
    if (disabled) return;
    const next = step.widgets[index + 1] ?? step.widgets[index - 1];
    onChange(step.widgets.filter((_, position) => position !== index));
    setAnnouncement(t("widgets.removed", { number: number(index + 1) }));
    requestAnimationFrame(() =>
      next
        ? focusWidget(next.key)
        : document
            .querySelector<HTMLButtonElement>(".welcome-widget-add")
            ?.focus(),
    );
  }
  const { drag, bindings } = useWelcomeWidgetDrag({
    list,
    widgets: step.widgets,
    disabled,
    onAdd: add,
    onMove: move,
    onCancel: () => setAnnouncement(t("adminWelcome.dragCancelled")),
  });
  const dropIndex =
    drag?.to === null || !drag
      ? null
      : drag.source.type === "existing" && drag.to >= drag.source.from
        ? drag.to + 1
        : drag.to;

  return (
    <div className="welcome-widget-workspace">
      <aside
        className="welcome-widget-palette"
        aria-labelledby={`welcome-palette-${step.key}`}
      >
        <h4 id={`welcome-palette-${step.key}`}>{t("widgets.palette")}</h4>
        <p className="fine-print">{t("widgets.paletteHint")}</p>
        <div className="welcome-widget-palette-items">
          {types.map((type) => {
            const Icon = icons[type];
            return (
              <div
                className="welcome-palette-item"
                key={type}
                data-widget-palette={type}
              >
                <button
                  type="button"
                  className="icon-button welcome-drag-handle"
                  disabled={!canAdd(type)}
                  aria-label={t("widgets.dragNew", { name: t(labels[type]) })}
                  {...bindings({ type: "new", widgetType: type })}
                >
                  <GripVertical size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="welcome-widget-add"
                  disabled={!canAdd(type)}
                  aria-label={t("widgets.add", { name: t(labels[type]) })}
                  onClick={() => add(type, step.widgets.length)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    {t(labels[type])}
                    {(type === "profile_photo" ||
                      type === "enable_notifications") &&
                      step.widgets.some((widget) => widget.type === type) && (
                        <small>{t("widgets.profileAdded")}</small>
                      )}
                  </span>
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <p className="fine-print welcome-widget-limit">{t("widgets.limit")}</p>
      </aside>
      <div className="welcome-widget-canvas">
        <div className="welcome-widget-canvas-heading">
          <h4>{t("widgets.canvas")}</h4>
          <span className="fine-print">
            {number(step.widgets.length)} / {number(12)}
          </span>
        </div>
        <ol
          className="welcome-widget-list"
          ref={list}
          aria-label={t("widgets.canvas")}
          data-drag-over={(drag?.to !== null && !!drag) || undefined}
        >
          {step.widgets.length === 0 && (
            <li
              className="welcome-widget-empty"
              data-drop={dropIndex === 0 || undefined}
            >
              <Plus size={24} aria-hidden="true" />
              <strong>{t("widgets.empty")}</strong>
              <p className="fine-print">{t("widgets.emptyHint")}</p>
            </li>
          )}
          {step.widgets.map((widget, index) => {
            const Icon = icons[widget.type];
            const textWidget =
              widget.type === "title" || widget.type === "text";
            const fieldId = `welcome-widget-${widget.key}`;
            return (
              <li
                key={widget.key}
                data-widget-key={widget.key}
                data-widget-type={widget.type}
                data-dragging={
                  (drag?.source.type === "existing" &&
                    drag.source.key === widget.key) ||
                  undefined
                }
                data-drop={
                  dropIndex === index
                    ? "before"
                    : index === step.widgets.length - 1 &&
                        dropIndex === step.widgets.length
                      ? "after"
                      : undefined
                }
              >
                <div className="welcome-widget-toolbar">
                  <button
                    type="button"
                    className="icon-button welcome-drag-handle welcome-widget-drag"
                    disabled={disabled}
                    aria-label={t("widgets.drag", {
                      number: number(index + 1),
                    })}
                    {...bindings({
                      type: "existing",
                      key: widget.key,
                      from: index,
                    })}
                  >
                    <GripVertical size={18} aria-hidden="true" />
                  </button>
                  <span className="welcome-widget-name">
                    <Icon size={17} aria-hidden="true" />
                    {t(labels[widget.type])}
                    <span>{number(index + 1)}</span>
                  </span>
                  <div className="welcome-widget-controls">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={disabled || index === 0}
                      aria-label={t("widgets.moveUp", {
                        number: number(index + 1),
                      })}
                      onClick={(event) =>
                        moveWithButton(index, index - 1, event.currentTarget)
                      }
                    >
                      <ArrowUp size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={disabled || index === step.widgets.length - 1}
                      aria-label={t("widgets.moveDown", {
                        number: number(index + 1),
                      })}
                      onClick={(event) =>
                        moveWithButton(index, index + 1, event.currentTarget)
                      }
                    >
                      <ArrowDown size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      disabled={disabled}
                      aria-label={t("widgets.remove", {
                        number: number(index + 1),
                      })}
                      onClick={() => remove(index)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="welcome-widget-fields">
                  {textWidget && (
                    <>
                      <label htmlFor={fieldId}>
                        {t(
                          widget.type === "title"
                            ? "widgets.titleField"
                            : "widgets.textField",
                          { number: number(index + 1) },
                        )}
                      </label>
                      {widget.type === "title" ? (
                        <input
                          id={fieldId}
                          value={widget.text}
                          disabled={disabled}
                          maxLength={240}
                          required
                          aria-describedby={`${fieldId}-count`}
                          onChange={(event) =>
                            update({ ...widget, text: event.target.value })
                          }
                        />
                      ) : (
                        <textarea
                          id={fieldId}
                          value={widget.text}
                          disabled={disabled}
                          rows={4}
                          maxLength={2000}
                          required
                          aria-describedby={`${fieldId}-count`}
                          onChange={(event) =>
                            update({ ...widget, text: event.target.value })
                          }
                        />
                      )}
                      <p
                        className="fine-print welcome-character-count"
                        id={`${fieldId}-count`}
                      >
                        {number(Array.from(widget.text).length)} /{" "}
                        {number(widget.type === "title" ? 120 : 1000)}
                      </p>
                    </>
                  )}
                  {widget.type === "profile_photo" && (
                    <p className="fine-print">{t("widgets.profileHint")}</p>
                  )}
                  {widget.type === "enable_notifications" && (
                    <p className="fine-print">
                      {t("notifications.widgetHint")}
                    </p>
                  )}
                  {widget.type === "media_upload" && (
                    <div className="welcome-media-settings">
                      <label htmlFor={fieldId}>
                        {t("categories.uploadDestination")}
                      </label>
                      <select
                        id={fieldId}
                        disabled={disabled}
                        value={widget.mediaUpload.categoryId ?? ""}
                        onChange={(event) =>
                          update({
                            ...widget,
                            mediaUpload: {
                              categoryId:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            },
                          })
                        }
                      >
                        <option value="">{t("categories.main")}</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.isPublic
                              ? category.name
                              : t("categories.privateOption", {
                                  name: category.name,
                                })}
                          </option>
                        ))}
                      </select>
                      {(widget.mediaUpload.categoryId === null ||
                        categories.find(
                          (category) =>
                            category.id === widget.mediaUpload.categoryId,
                        )?.isPublic) && (
                        <p className="fine-print">{t("categories.mainHint")}</p>
                      )}
                      <p className="fine-print">{t("categories.manageHint")}</p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="welcome-announcement" role="status">
        {announcement}
      </p>
    </div>
  );
}
