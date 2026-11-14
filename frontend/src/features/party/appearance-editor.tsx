"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, Pipette } from "lucide-react";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useRouteRefresh } from "@/lib/use-route-refresh";
import { useI18n } from "@/lib/i18n-context";
import { accentColours, accentSwatches, textOn } from "./appearance";
import type { Appearance, Configuration } from "./contracts";
import "./appearance-editor.css";

const themes = ["dark", "light"] as const;
// The native picker reports every move; save once it rests.
const pickerDelay = 600;

function swatchStyle(color: string) {
  return { "--swatch": color, "--swatch-text": textOn(color) } as CSSProperties;
}

export function AppearanceEditor({
  initial,
  onSave,
}: {
  initial: Appearance;
  onSave: (patch: Partial<Configuration>) => Promise<void>;
}) {
  const { t } = useI18n();
  const refreshRoute = useRouteRefresh();
  const id = useId();
  const [draft, setDraft] = useState(initial);
  // Saves read the latest choice, which may be newer than the last render.
  const latest = useRef(initial);
  const saved = useRef(initial);
  const [error, setError] = useState<string | null>(null);
  const [announced, setAnnounced] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const pickerTimer = useRef<number | undefined>(undefined);
  const autosave = useAutosave({ save });
  const flush = autosave.flush;
  const custom = !accentSwatches.some(({ color }) => color === draft.accent);
  const { readable } = accentColours(draft.accent, draft.theme);

  async function save() {
    const appearance = latest.current;
    if (
      appearance.theme === saved.current.theme &&
      appearance.accent === saved.current.accent
    )
      return true;
    setError(null);
    try {
      await onSave({ appearance });
      saved.current = appearance;
      setAnnounced(true);
      refreshRoute();
      return true;
    } catch (err) {
      setError(errorMessage(err, t));
      return false;
    }
  }

  function choose(next: Appearance, delay = 0) {
    latest.current = next;
    setDraft(next);
    setError(null);
    setAnnounced(false);
    window.clearTimeout(pickerTimer.current);
    if (delay) pickerTimer.current = window.setTimeout(flush, delay);
    else void flush();
  }

  // React's onChange follows the picker's continuous input events; the
  // native change event marks the colour the host settled on.
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    function settle() {
      window.clearTimeout(pickerTimer.current);
      void flush();
    }
    input.addEventListener("change", settle);
    return () => {
      input.removeEventListener("change", settle);
      window.clearTimeout(pickerTimer.current);
    };
  }, [flush]);

  return (
    <div className="appearance-editor">
      <fieldset className="appearance-group">
        <legend>{t("appearance.theme")}</legend>
        <div className="appearance-themes">
          {themes.map((theme) => (
            <label className="appearance-theme" key={theme}>
              <input
                type="radio"
                name={`${id}-theme`}
                value={theme}
                checked={draft.theme === theme}
                onChange={() => choose({ ...latest.current, theme })}
              />
              <span
                className="appearance-theme-preview"
                data-theme={theme}
                aria-hidden="true"
              >
                <span />
                <span />
              </span>
              <span className="appearance-theme-name">
                {t(`appearance.${theme}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="appearance-group">
        <legend>{t("appearance.accent")}</legend>
        <div className="appearance-swatches">
          {accentSwatches.map(({ name, color }) => (
            <label
              className="appearance-swatch"
              key={name}
              style={swatchStyle(color)}
            >
              <input
                type="radio"
                name={`${id}-accent`}
                value={color}
                checked={draft.accent === color}
                aria-label={t(`appearance.${name}`)}
                onChange={() => choose({ ...latest.current, accent: color })}
              />
              {draft.accent === color && (
                <Check size={20} strokeWidth={3} aria-hidden="true" />
              )}
            </label>
          ))}
          <label
            className="appearance-swatch appearance-custom"
            style={custom ? swatchStyle(draft.accent) : undefined}
            data-selected={custom || undefined}
          >
            <input
              ref={picker}
              type="color"
              value={draft.accent}
              aria-label={t("appearance.custom")}
              onChange={(event) =>
                choose(
                  { ...latest.current, accent: event.target.value },
                  pickerDelay,
                )
              }
            />
            {custom ? (
              <Check size={20} strokeWidth={3} aria-hidden="true" />
            ) : (
              <Pipette size={19} aria-hidden="true" />
            )}
          </label>
        </div>
        {!readable && (
          <p className="fine-print appearance-warning">
            {t("appearance.unreadable")}
          </p>
        )}
      </fieldset>
      <ErrorNotice message={error} />
      <span className="status-notice" role="status">
        {autosave.saving ? t("configuration.saving") : ""}
      </span>
      <SavedAnnouncement
        message={announced && !autosave.saving ? t("appearance.saved") : ""}
      />
    </div>
  );
}
