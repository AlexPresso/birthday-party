"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import {
  welcomeUploadContextSchema,
  type WelcomeUploadContext,
} from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import { MediaPicker } from "@/features/media/media-picker";
import { UploadQueue } from "@/features/media/upload-queue";
import { ErrorNotice } from "@/components/ui";

export function WelcomeMedia({
  revision,
  widgetIndex,
}: {
  revision: number;
  widgetIndex: number;
}) {
  const { t } = useI18n();
  const [context, setContext] = useState<WelcomeUploadContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    void api(
      `/welcome/upload-context?widgetIndex=${widgetIndex}`,
      welcomeUploadContextSchema,
      {
        signal: controller.signal,
      },
    )
      .then((next) => {
        if (disposed) return;
        if (next.revision !== revision || next.widgetIndex !== widgetIndex) {
          setError(t("errors.welcome_conflict"));
          return;
        }
        setContext(next);
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause, t));
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [attempt, revision, widgetIndex, t]);

  const category = context?.category;
  const categoryName = category
    ? category.isPublic
      ? category.name
      : t("categories.privateOption", { name: category.name })
    : t("categories.main");

  return (
    <div
      className="welcome-media"
      data-welcome-widget-index={widgetIndex}
      role="group"
      aria-label={
        context
          ? t("categories.destination", {
              name: categoryName,
            })
          : t("widgets.mediaUpload")
      }
    >
      {context ? (
        <>
          <MediaPicker
            limits={context.limits}
            destination={{
              categoryId: context.category?.id ?? null,
              welcomeRevision: revision,
              welcomeWidgetIndex: widgetIndex,
            }}
          >
            <p className="fine-print">
              {t("categories.destination", {
                name: categoryName,
              })}
            </p>
            {(!category || category.isPublic) && (
              <p className="fine-print">{t("categories.publicHint")}</p>
            )}
          </MediaPicker>
          <UploadQueue widgetIndex={widgetIndex} />
        </>
      ) : error ? (
        <>
          <ErrorNotice message={error} />
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {t("welcome.retry")}
          </button>
        </>
      ) : (
        <p className="muted" role="status">
          {t("categories.loading")}
        </p>
      )}
    </div>
  );
}
