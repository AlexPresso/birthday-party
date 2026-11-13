"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useRouteRefresh } from "@/lib/use-route-refresh";
import { useI18n } from "@/lib/i18n-context";
import { locales } from "@/lib/locale";
import type { Configuration } from "./contracts";
import "./configuration-editor.css";

type CopyMode = "default" | "hidden" | "custom";
const copyScopes = ["shared", ...locales] as const;
type CopyScope = (typeof copyScopes)[number];

function CopyField({
  name,
  type,
  initial,
}: {
  name: string;
  type: "title" | "description";
  initial: string | null;
}) {
  const { t } = useI18n();
  const id = useId();
  const [mode, setMode] = useState<CopyMode>(
    initial === null ? "default" : initial === "" ? "hidden" : "custom",
  );
  const [text, setText] = useState(initial ?? "");
  const limit = type === "title" ? 200 : 2000;
  const contentProps = {
    id,
    name: `${name}.text`,
    value: text,
    required: true,
    "aria-describedby": `${id}-limit`,
    ref(element: HTMLInputElement | HTMLTextAreaElement | null) {
      element?.setCustomValidity(
        [...text].length > limit
          ? t("configuration.copyTooLong", { limit })
          : "",
      );
    },
    onChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
      setText(event.target.value);
    },
  };

  return (
    <div>
      <label htmlFor={`${id}-mode`}>
        {t(
          type === "title"
            ? "configuration.titleMode"
            : "configuration.descriptionMode",
        )}
      </label>
      <select
        id={`${id}-mode`}
        name={`${name}.mode`}
        value={mode}
        onChange={(event) => setMode(event.target.value as CopyMode)}
      >
        <option value="default">{t("configuration.default")}</option>
        <option value="hidden">{t("configuration.hidden")}</option>
        <option value="custom">{t("configuration.custom")}</option>
      </select>
      {mode === "custom" && (
        <div className="configuration-copy-content">
          <label htmlFor={id}>{t(`configuration.${type}`)}</label>
          {type === "title" ? (
            <input {...contentProps} />
          ) : (
            <textarea {...contentProps} rows={4} />
          )}
          <p className="fine-print" id={`${id}-limit`}>
            {t("configuration.copyLimit", { limit })}
          </p>
        </div>
      )}
    </div>
  );
}

function readCopy(form: FormData, prefix: string) {
  function read(type: "title" | "description") {
    const name = `${prefix}.${type}`;
    const mode = form.get(`${name}.mode`);
    if (mode === "default") return null;
    if (mode === "hidden") return "";
    return String(form.get(`${name}.text`) ?? "");
  }
  return { title: read("title"), description: read("description") };
}

export function ConfigurationEditor({
  initial,
  section,
  onSave,
}: {
  initial: Configuration;
  section: "age" | "invitation" | "uploads";
  onSave: (patch: Partial<Configuration>) => Promise<void>;
}) {
  const { t } = useI18n();
  const refreshRoute = useRouteRefresh();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copyScope, setCopyScope] = useState<CopyScope>("shared");
  const [age, setAge] = useState(String(initial.age));
  const [imageSize, setImageSize] = useState(String(initial.imageSizeMB));
  const [videoSize, setVideoSize] = useState(String(initial.videoSizeMB));
  const [revision, setRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const lastSaved = useRef(
    JSON.stringify(
      section === "age"
        ? { age: initial.age }
        : section === "uploads"
          ? {
              imageSizeMB: initial.imageSizeMB,
              videoSizeMB: initial.videoSizeMB,
            }
          : { invitation: initial.invitation },
    ),
  );
  const dirty = revision !== savedRevision;
  const autosave = useAutosave({ save });

  async function save() {
    if (!form.current?.reportValidity()) return false;
    const fields = new FormData(form.current);
    const patch: Partial<Configuration> = {};
    if (section === "age") {
      patch.age = Number(fields.get("age"));
    } else if (section === "uploads") {
      patch.imageSizeMB = Number(fields.get("imageSizeMB"));
      patch.videoSizeMB = Number(fields.get("videoSizeMB"));
    } else {
      patch.invitation = {
        ...readCopy(fields, "invitation"),
        locales: {
          en: readCopy(fields, "en"),
          fr: readCopy(fields, "fr"),
          de: readCopy(fields, "de"),
          it: readCopy(fields, "it"),
          es: readCopy(fields, "es"),
        },
      };
    }
    const snapshot = JSON.stringify(patch);
    if (snapshot === lastSaved.current) {
      setSavedRevision(revision);
      setError(null);
      setSaved(true);
      return true;
    }
    setError(null);
    setSaved(false);
    try {
      await onSave(patch);
      lastSaved.current = snapshot;
      setSavedRevision(revision);
      setSaved(true);
      refreshRoute();
      return true;
    } catch (err) {
      setError(errorMessage(err, t));
      return false;
    }
  }

  return (
    <form
      ref={form}
      className="configuration-editor"
      aria-label={t("configuration.heading")}
      onSubmit={(event) => {
        event.preventDefault();
        void autosave.flush();
      }}
      onBlur={autosave.onBlur}
      onChange={() => {
        setRevision((current) => current + 1);
        setError(null);
        setSaved(false);
      }}
      onInvalidCapture={(event) => {
        const invalid = event.currentTarget.querySelector(
          "input:invalid, textarea:invalid, select:invalid",
        );
        // Report one field at a time, including when other scopes are invalid.
        if (event.target !== invalid) event.preventDefault();
        const group = invalid?.closest<HTMLElement>("[data-copy-scope]");
        const scope = copyScopes.find(
          (candidate) => candidate === group?.dataset.copyScope,
        );
        if (scope && scope !== copyScope) {
          // Native validation focuses the first invalid input immediately.
          flushSync(() => setCopyScope(scope));
        }
      }}
    >
      <fieldset className="configuration-fields">
        {section === "age" && (
          <div>
            <label htmlFor={`${id}-age`}>{t("configuration.age")}</label>
            <input
              id={`${id}-age`}
              name="age"
              type="number"
              min={1}
              max={150}
              step={1}
              required
              value={age}
              onChange={(event) => setAge(event.target.value)}
            />
          </div>
        )}
        {section === "uploads" && (
          <div className="configuration-upload-fields">
            <p className="fine-print" id={`${id}-upload-limits`}>
              {t("configuration.uploadHint")}
            </p>
            <div>
              <label htmlFor={`${id}-images`}>
                {t("configuration.images")}
              </label>
              <input
                id={`${id}-images`}
                name="imageSizeMB"
                type="number"
                min={1}
                max={1024}
                step={1}
                required
                value={imageSize}
                onChange={(event) => setImageSize(event.target.value)}
                aria-describedby={`${id}-upload-limits`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-videos`}>
                {t("configuration.videos")}
              </label>
              <input
                id={`${id}-videos`}
                name="videoSizeMB"
                type="number"
                min={1}
                max={1024}
                step={1}
                required
                value={videoSize}
                onChange={(event) => setVideoSize(event.target.value)}
                aria-describedby={`${id}-upload-limits`}
              />
            </div>
          </div>
        )}
        {section === "invitation" && (
          <>
            <p className="fine-print">{t("configuration.publicHint")}</p>
            <div className="configuration-scope">
              <label htmlFor={`${id}-scope`}>{t("configuration.scope")}</label>
              <select
                id={`${id}-scope`}
                value={copyScope}
                onChange={(event) =>
                  setCopyScope(event.target.value as CopyScope)
                }
              >
                {copyScopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {t(`configuration.${scope}`)}
                  </option>
                ))}
              </select>
            </div>
            {copyScopes.map((scope) => {
              const copy =
                scope === "shared"
                  ? initial.invitation
                  : initial.invitation.locales[scope];
              const prefix = scope === "shared" ? "invitation" : scope;
              return (
                <fieldset
                  className="configuration-copy-group"
                  key={scope}
                  data-copy-scope={scope}
                  hidden={scope !== copyScope}
                >
                  <legend className="visually-hidden">
                    {t(`configuration.${scope}`)}
                  </legend>
                  <p className="fine-print">
                    {t(
                      scope === "shared"
                        ? "configuration.defaultHint"
                        : "configuration.languageHint",
                    )}
                  </p>
                  <div className="configuration-copy-fields">
                    <CopyField
                      name={`${prefix}.title`}
                      type="title"
                      initial={copy.title}
                    />
                    <CopyField
                      name={`${prefix}.description`}
                      type="description"
                      initial={copy.description}
                    />
                  </div>
                </fieldset>
              );
            })}
          </>
        )}
      </fieldset>
      <ErrorNotice message={error} />
      <div className="configuration-save">
        <span className="success-notice" role="status">
          {autosave.saving ? t("configuration.saving") : ""}
        </span>
        <SavedAnnouncement
          message={
            !autosave.saving && saved && !dirty ? t("configuration.saved") : ""
          }
        />
      </div>
    </form>
  );
}
