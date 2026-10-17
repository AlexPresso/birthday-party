"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bell, BellOff, Check, RefreshCw } from "lucide-react";
import { api, ApiError, errorMessage, remove } from "@/lib/api";
import {
  notificationConfigSchema,
  notificationSavedSchema,
  notificationStatusSchema,
} from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import {
  enableNotifications,
  notificationKeyMatches,
  waitForPush,
} from "./push-notifications";
import { ErrorNotice } from "@/components/ui";
import "./notification-control.css";

type State =
  | "off"
  | "enabled"
  | "denied"
  | "insecure"
  | "unsupported"
  | "install"
  | "error";
type Ready = { registration: ServiceWorkerRegistration; publicKey: string };

function availability(): "insecure" | "unsupported" | "install" | null {
  if (!window.isSecureContext) return "insecure";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "install";
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return "unsupported";
  return null;
}

function permissionState(subscribed: boolean): "enabled" | "off" | "denied" {
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && subscribed
    ? "enabled"
    : "off";
}

export function NotificationControl() {
  const { t, locale } = useI18n();
  const heading = useId();
  const [state, setState] = useState<State>("off");
  const [busy, setBusy] = useState<
    "checking" | "enabling" | "disabling" | null
  >("checking");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ready = useRef<Ready | null>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    ready.current = null;
    const { signal } = controller;
    async function check() {
      const unavailable = availability();
      if (unavailable) {
        setState(unavailable);
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const [config, registration] = await waitForPush(
        Promise.all([
          api("/notifications", notificationConfigSchema, { signal }),
          navigator.serviceWorker
            .register("/sw.js", { scope: "/", updateViaCache: "none" })
            .then(() => navigator.serviceWorker.ready),
        ]),
        signal,
      );
      signal.throwIfAborted();
      ready.current = { registration, publicKey: config.publicKey };
      const subscription = await waitForPush(
        registration.pushManager.getSubscription(),
        signal,
      );
      signal.throwIfAborted();
      if (
        Notification.permission !== "granted" ||
        !subscription ||
        !notificationKeyMatches(subscription, config.publicKey)
      ) {
        setState("off");
        return;
      }
      const status = await waitForPush(
        api("/notifications/status", notificationStatusSchema, {
          method: "POST",
          body: { endpoint: subscription.endpoint },
          signal,
        }),
        signal,
      );
      signal.throwIfAborted();
      setState(permissionState(status.subscribed));
    }
    void check()
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setState("error");
          setError(
            cause instanceof ApiError
              ? errorMessage(cause, t)
              : t("notifications.checkFailed"),
          );
        }
      })
      .finally(() => {
        if (!signal.aborted && operation.current === controller) {
          operation.current = null;
          setBusy(null);
        }
        controller.abort();
      });
    const refresh = () => {
      if (!operation.current && document.visibilityState === "visible") {
        setBusy("checking");
        setError(null);
        setAttempt((current) => current + 1);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      controller.abort();
      operation.current?.abort();
    };
  }, [attempt, t]);

  async function enable() {
    if (operation.current || !ready.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy("enabling");
    setError(null);
    try {
      const next = await enableNotifications({
        ...ready.current,
        requestPermission: () => Notification.requestPermission(),
        locale,
        signal: controller.signal,
        save: (subscription) =>
          waitForPush(
            api("/notifications/subscription", notificationSavedSchema, {
              method: "PUT",
              body: subscription,
              signal: controller.signal,
            }),
            controller.signal,
          ),
      });
      if (!controller.signal.aborted)
        setState(next === "enabled" ? permissionState(true) : next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setState(Notification.permission === "denied" ? "denied" : "off");
        setError(
          cause instanceof ApiError
            ? errorMessage(cause, t)
            : t("notifications.enableFailed"),
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(null);
      }
      controller.abort();
    }
  }

  async function disable() {
    if (operation.current || !ready.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy("disabling");
    setError(null);
    try {
      const subscription = await waitForPush(
        ready.current.registration.pushManager.getSubscription(),
        controller.signal,
      );
      if (subscription) {
        // Delivery belongs to this signed-in session. Keep the browser endpoint
        // available for a later explicit opt-in, including on a shared device.
        await waitForPush(
          remove("/notifications/subscription", "DELETE", {
            body: { endpoint: subscription.endpoint },
            signal: controller.signal,
          }),
          controller.signal,
        );
      }
      controller.signal.throwIfAborted();
      setState("off");
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof ApiError
            ? errorMessage(cause, t)
            : t("notifications.disableFailed"),
        );
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(null);
      }
      controller.abort();
    }
  }

  const recheck = () => {
    setBusy("checking");
    setError(null);
    setAttempt((current) => current + 1);
  };
  return (
    <section
      className="notification-control"
      aria-labelledby={heading}
      aria-busy={busy !== null}
    >
      <h3 id={heading}>
        <Bell size={19} aria-hidden="true" />
        {t("notifications.title")}
      </h3>
      <p
        className={`notification-status ${state === "enabled" ? "success-notice" : "muted"}`}
        role="status"
      >
        {!busy && state === "enabled" && <Check size={17} aria-hidden="true" />}
        {busy ? t(`notifications.${busy}`) : t(`notifications.${state}`)}
      </p>
      {state === "install" && (
        <p className="fine-print">{t("notifications.installHint")}</p>
      )}
      {state === "denied" && (
        <p className="fine-print">{t("notifications.deniedHint")}</p>
      )}
      <ErrorNotice message={error} />
      <div className="notification-actions">
        {state === "enabled" ? (
          <button
            type="button"
            className="button secondary"
            disabled={busy !== null}
            onClick={() => void disable()}
          >
            <BellOff size={17} aria-hidden="true" />
            {t("notifications.disable")}
          </button>
        ) : state === "off" ? (
          <button
            type="button"
            className="button primary"
            disabled={busy !== null}
            onClick={() => void enable()}
          >
            <Bell size={17} aria-hidden="true" />
            {t("notifications.enable")}
          </button>
        ) : (
          (state === "error" || state === "denied") && (
            <button
              type="button"
              className="button secondary"
              disabled={busy !== null}
              onClick={recheck}
            >
              <RefreshCw size={17} aria-hidden="true" />
              {t(
                state === "denied"
                  ? "notifications.recheck"
                  : "notifications.retry",
              )}
            </button>
          )
        )}
      </div>
    </section>
  );
}
