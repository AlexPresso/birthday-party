"use client";

import { Camera, Check, Images, X } from "lucide-react";
import type { MediaCategory } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n-context";
import type { StepDraft } from "./welcome-admin";

function ActionSettings({
  step,
  categories,
  disabled,
  onChange,
}: {
  step: StepDraft;
  categories: MediaCategory[];
  disabled: boolean;
  onChange: (step: StepDraft) => void;
}) {
  const { t } = useI18n();
  switch (step.action) {
    case "profile_photo":
      return <p className="fine-print">{t("adminWelcome.noActionSettings")}</p>;
    case "media_upload":
      return (
        <div className="welcome-media-settings">
          <label htmlFor={`welcome-destination-${step.key}`}>
            {t("categories.uploadDestination")}
          </label>
          <select
            id={`welcome-destination-${step.key}`}
            disabled={disabled}
            value={step.mediaUpload.categoryId ?? ""}
            onChange={(event) =>
              onChange({
                ...step,
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
                  : t("categories.privateOption", { name: category.name })}
              </option>
            ))}
          </select>
          <p className="fine-print">
            {t(
              step.mediaUpload.categoryId !== null &&
                !categories.find(
                  (category) => category.id === step.mediaUpload.categoryId,
                )?.isPublic
                ? "categories.privateHint"
                : "categories.mainHint",
            )}
          </p>
          <p className="fine-print">{t("categories.manageHint")}</p>
        </div>
      );
    default:
      return null;
  }
}

export function WelcomeActionPanel({
  step,
  disabled,
  onChange,
  categories,
}: {
  step: StepDraft;
  disabled: boolean;
  onChange: (step: StepDraft) => void;
  categories: MediaCategory[];
}) {
  const { t } = useI18n();
  return (
    <aside
      className="welcome-action-panel"
      aria-labelledby="welcome-actions-heading"
    >
      <h3 id="welcome-actions-heading">{t("adminWelcome.action")}</h3>
      <p className="fine-print">{t("adminWelcome.actionHint")}</p>
      <button
        type="button"
        className="welcome-action-card"
        aria-pressed={step.action === "profile_photo"}
        disabled={disabled}
        onClick={() =>
          onChange({ ...step, action: "profile_photo", mediaUpload: undefined })
        }
      >
        <Camera size={20} aria-hidden="true" />
        <span>{t("adminWelcome.profilePhotoAction")}</span>
        {step.action === "profile_photo" && (
          <Check size={16} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="welcome-action-card"
        aria-pressed={step.action === "media_upload"}
        disabled={disabled}
        onClick={() => {
          if (step.action !== "media_upload")
            onChange({
              ...step,
              action: "media_upload",
              mediaUpload: { categoryId: null },
            });
        }}
      >
        <Images size={20} aria-hidden="true" />
        <span>{t("categories.mediaAction")}</span>
        {step.action === "media_upload" && (
          <Check size={16} aria-hidden="true" />
        )}
      </button>
      {step.action ? (
        <div className="welcome-action-settings">
          <h4>{t("adminWelcome.actionSettings")}</h4>
          <ActionSettings
            step={step}
            categories={categories}
            disabled={disabled}
            onChange={onChange}
          />
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() =>
              onChange({ ...step, action: null, mediaUpload: undefined })
            }
          >
            <X size={16} aria-hidden="true" />
            {t("adminWelcome.removeAction")}
          </button>
        </div>
      ) : (
        <p className="fine-print welcome-action-empty">
          {t("adminWelcome.textOnly")}
        </p>
      )}
    </aside>
  );
}
