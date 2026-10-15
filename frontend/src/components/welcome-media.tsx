"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import {
  welcomeUploadContextSchema,
  type WelcomeUploadContext,
} from "@/lib/contracts";
import { useI18n } from "@/lib/i18n-context";
import { UploadProvider } from "./upload-provider";
import { MediaPicker } from "./media-picker";
import { UploadQueue } from "./upload-queue";
import { ErrorNotice } from "./ui";

export function WelcomeMedia({ revision }: { revision: number }) {
  const { t } = useI18n();
  const [context, setContext] = useState<WelcomeUploadContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    void api("/welcome/upload-context", welcomeUploadContextSchema, {
      signal: controller.signal,
    })
      .then((next) => {
        if (disposed) return;
        if (next.revision !== revision) {
          setError(t("errors.welcome_conflict"));
          return;
        }
        setContext(next);
      })
      .catch((cause) => {
        if (!disposed)
          setError(
            controller.signal.aborted
              ? t("common.connectionFailed")
              : errorMessage(cause, t),
          );
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(deadline);
    };
  }, [attempt, revision, t]);

  return (
    <div className="welcome-media">
      {context ? (
        <UploadProvider welcomeRevision={revision}>
          <MediaPicker
            limits={context.limits}
            destination={{
              categoryId: context.category?.id ?? null,
              welcomeRevision: revision,
            }}
          >
            <p className="fine-print">
              {t("categories.destination", {
                name: context.category?.name ?? t("categories.main"),
              })}
            </p>
            <p className="fine-print">
              {t(
                context.category && !context.category.isPublic
                  ? "categories.privateHint"
                  : "categories.publicHint",
              )}
            </p>
          </MediaPicker>
          <UploadQueue />
        </UploadProvider>
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
