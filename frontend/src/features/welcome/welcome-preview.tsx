"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Camera,
  DoorOpen,
  ImagePlus,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { Avatar } from "@/components/avatar";
import { BrandMark } from "@/components/brand-mark";
import type { Guest } from "@/features/guests/contracts";
import type { MediaCategory } from "@/features/media/contracts";
import type { WelcomeStep, WelcomeWidget } from "./contracts";
import "./waiting-room.css";
import "@/features/notifications/notification-control.css";

/**
 * The host's view of the welcome as guests will see it, unsaved edits
 * included, one step after another. Nothing in it reaches the server: the
 * photo, upload and notification widgets are shown but do nothing, and rules
 * can be ticked only on this screen.
 */
export function WelcomePreview({
  steps,
  start,
  host,
  title,
  categories,
  onClose,
}: {
  steps: WelcomeStep[];
  start: number;
  host: Guest;
  title: string;
  categories: MediaCategory[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="welcome-preview"
      aria-labelledby="welcome-preview-label"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="welcome-page">
        <header className="welcome-header">
          <div className="brand">
            <BrandMark />
            {title && <strong>{title}</strong>}
          </div>
          <span id="welcome-preview-label" className="welcome-preview-badge">
            {t("adminWelcome.preview")}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("adminWelcome.closePreview")}
            autoFocus
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <section className="welcome-content">
          <div className="welcome-stage panel">
            <p className="welcome-step-number" aria-live="polite">
              {t("welcome.step", { number: index + 1 })}
            </p>
            {step && (
              <div className="welcome-widgets" key={index}>
                {step.widgets.map((widget, position) => (
                  <PreviewWidget
                    key={position}
                    widget={widget}
                    host={host}
                    categories={categories}
                  />
                ))}
              </div>
            )}
            <div className="welcome-navigation">
              <button
                type="button"
                className="button secondary"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <ArrowLeft size={17} aria-hidden="true" />
                {t("welcome.previous")}
              </button>
              {last ? (
                <button type="button" className="button primary" disabled>
                  <DoorOpen size={17} aria-hidden="true" />
                  {t("welcome.finish")}
                </button>
              ) : (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setIndex(index + 1)}
                >
                  {t("welcome.next")}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </dialog>
  );
}

function PreviewWidget({
  widget,
  host,
  categories,
}: {
  widget: WelcomeWidget;
  host: Guest;
  categories: MediaCategory[];
}) {
  const { t } = useI18n();
  switch (widget.type) {
    case "title":
      return <h2 className="welcome-widget-title">{widget.text}</h2>;
    case "text":
      return <p className="welcome-body">{widget.text}</p>;
    case "profile_photo":
      return (
        <div className="welcome-profile">
          <div className="welcome-profile-identity">
            <Avatar
              name={host.name}
              avatarUrl={host.avatarUrl}
              className="large"
            />
            <strong>{host.name}</strong>
          </div>
          <button type="button" className="button secondary" disabled>
            <Camera size={17} aria-hidden="true" />
            {t("profile.choose")}
          </button>
        </div>
      );
    case "enable_notifications":
      return (
        <section className="notification-control">
          <div className="notification-copy">
            <h3>
              <Bell size={19} aria-hidden="true" />
              {t("notifications.title")}
            </h3>
          </div>
          <div className="notification-actions">
            <button type="button" className="button primary" disabled>
              <Bell size={17} aria-hidden="true" />
              {t("notifications.enable")}
            </button>
          </div>
        </section>
      );
    case "media_upload": {
      const category = categories.find(
        (candidate) => candidate.id === widget.mediaUpload.categoryId,
      );
      return (
        <div className="welcome-media">
          <button type="button" className="button secondary" disabled>
            <ImagePlus size={17} aria-hidden="true" />
            {t("photos.add")}
          </button>
          <p className="fine-print">
            {t("categories.destination", {
              name: !category
                ? t("categories.main")
                : category.isPublic
                  ? category.name
                  : t("categories.privateOption", { name: category.name }),
            })}
          </p>
        </div>
      );
    }
    case "rules":
      return (
        <div className="welcome-rules">
          <fieldset>
            <legend className="visually-hidden">{t("welcome.rules")}</legend>
            {widget.rules.map((rule, position) => (
              <label key={position} className="welcome-rule">
                <input type="checkbox" />
                <span>{rule}</span>
              </label>
            ))}
          </fieldset>
        </div>
      );
  }
}
