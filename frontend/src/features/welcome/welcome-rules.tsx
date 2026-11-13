"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { ErrorNotice } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import { welcomeSchema, type Welcome } from "./contracts";

/**
 * The rules of the current step, one checkbox each. Ticks on some of the rules
 * stay in this component; the server only stores whether all of them are
 * ticked, so a request goes out when the last box is ticked and when a box of
 * an accepted list is unticked.
 */
export function WelcomeRules({
  rules,
  accepted,
  revision,
  onChange,
  onConflict,
}: {
  rules: string[];
  accepted: boolean;
  /** The guest's latest progress revision. */
  revision: number;
  onChange: (welcome: Welcome) => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const [ticked, setTicked] = useState(() => rules.map(() => accepted));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  // The boxes are all ticked exactly when the server holds an acceptance. A
  // host changing the number of rules, or the guest's other tab, breaks that:
  // follow the server then. Unrelated responses keep the partial ticks.
  if (
    !pending &&
    (ticked.length !== rules.length || ticked.every(Boolean) !== accepted)
  )
    setTicked(rules.map(() => accepted));

  async function toggle(index: number, checked: boolean) {
    if (pending) return;
    const next = ticked.map((value, position) =>
      position === index ? checked : value,
    );
    setTicked(next);
    setError(null);
    const complete = next.every(Boolean);
    if (complete === accepted) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      onChange(
        await api("/welcome/rules", welcomeSchema, {
          method: "PUT",
          body: { revision, accepted: complete },
          signal: controller.signal,
        }),
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setTicked(ticked);
      setError(errorMessage(cause, t));
      if (cause instanceof ApiError && cause.code === "errors.welcome_conflict")
        onConflict();
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="welcome-rules">
      <fieldset aria-busy={pending}>
        <legend className="visually-hidden">{t("welcome.rules")}</legend>
        {rules.map((rule, index) => (
          <label key={index} className="welcome-rule">
            {/* A disabled box would drop the keyboard focus during the request. */}
            <input
              type="checkbox"
              checked={ticked[index] === true}
              aria-disabled={pending}
              onChange={(event) => void toggle(index, event.target.checked)}
            />
            <span>{rule}</span>
          </label>
        ))}
      </fieldset>
      <ErrorNotice message={error} />
    </div>
  );
}
