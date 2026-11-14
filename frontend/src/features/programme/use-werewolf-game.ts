"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useLatestState } from "@/lib/use-latest-state";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import {
  eventsSchema,
  werewolfSchema,
  type PartyEvent,
  type Werewolf,
} from "./contracts";

export type ActivityHeading = Pick<PartyEvent, "id" | "title" | "description">;

/** A request body, or how to build it from the revision current when sent. */
type CommandBody = object | ((revision: number) => object);

/** Sends one change to the game and resolves with the view it returns. */
export type SendCommand = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: CommandBody,
) => Promise<Werewolf>;

/** Sends a change and reports a failure on the page; resolves to its success. */
export type RunCommand = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: CommandBody,
  /** What screen readers hear once the page shows the result. */
  announcement?: string,
) => Promise<boolean>;

/**
 * Owns one viewer's view of a werewolf game. It follows the programme topic
 * like the other activity pages and sends changes one at a time, each with
 * the revision the previous one returned. A change that carries a revision
 * and meets a conflict is sent once more with the game's current revision.
 */
export function useWerewolfGame(
  event: ActivityHeading,
  initial: Werewolf,
  isAdmin: boolean,
) {
  const { t } = useI18n();
  const [game, setGame, latestGame] = useLatestState(initial);
  const [heading, setHeading] = useState(event);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Changes sent or waiting: a read answered meanwhile is older than them.
  const waiting = useRef(0);
  const generation = useRef(0);
  const unmount = useRef<AbortController | null>(null);
  const path = `/programme/${event.id}/werewolf`;

  const { connectionFailed, refresh, retry } = useRealtimeResource({
    topic: "programme",
    hasInitialData: true,
    async read(signal) {
      const started = generation.current;
      const [result, events] = await Promise.all([
        api(path, werewolfSchema, { signal }),
        api(isAdmin ? "/admin/programme" : "/programme", eventsSchema, {
          signal,
        }),
      ]);
      signal.throwIfAborted();
      const latest = events.items.find((item) => item.id === event.id);
      if (!latest || latest.locked) {
        window.location.replace("/programme");
        return;
      }
      if (started === generation.current && waiting.current === 0) {
        setGame(result);
        setHeading({
          id: latest.id,
          title: latest.title,
          description: latest.description,
        });
      }
      setRefreshError(null);
    },
    onError(error) {
      // Deleted or locked again: the page no longer exists for this viewer.
      if (error instanceof ApiError && error.status === 404) {
        window.location.replace("/programme");
        return;
      }
      setRefreshError(errorMessage(error, t));
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    unmount.current = controller;
    return () => controller.abort();
  }, []);

  const send = useCallback<SendCommand>(
    (commandPath, method, body) => {
      waiting.current++;
      setBusy(true);
      async function run() {
        const signal = unmount.current?.signal;
        const attempt = () =>
          api(`${path}${commandPath}`, werewolfSchema, {
            method,
            body:
              typeof body === "function" ? body(latestGame().revision) : body,
            signal,
          });
        generation.current++;
        try {
          let result;
          try {
            result = await attempt();
          } catch (error) {
            const stale =
              typeof body === "function" &&
              error instanceof ApiError &&
              error.code === "errors.activity_conflict";
            if (!stale) throw error;
            // The revision can move without the game changing, when the host
            // renames the event for instance: read it and try once more. A
            // command the game really refuses is refused again.
            setGame(await api(path, werewolfSchema, { signal }));
            result = await attempt();
          }
          generation.current++;
          setGame(result);
          return result;
        } finally {
          waiting.current--;
          if (waiting.current === 0 && !signal?.aborted) {
            setBusy(false);
            // Catches up with a signal that arrived during the changes.
            void refresh();
          }
        }
      }
      const result = queue.current.then(run);
      queue.current = result.catch(() => undefined);
      return result;
    },
    [path, latestGame, setGame, refresh],
  );

  const command = useCallback<RunCommand>(
    async (commandPath, method, body, announcement) => {
      setActionError(null);
      setNotice("");
      try {
        await send(commandPath, method, body);
        setNotice(announcement ?? t("werewolf.updated"));
        return true;
      } catch (error) {
        if (!unmount.current?.signal.aborted)
          setActionError(errorMessage(error, t));
        return false;
      }
    },
    [send, t],
  );

  return {
    game,
    heading,
    busy,
    notice,
    /** What went wrong last, if the page still has to say it. */
    message:
      actionError ??
      refreshError ??
      (connectionFailed ? t("common.connectionFailed") : null),
    retry() {
      setActionError(null);
      setRefreshError(null);
      void retry();
    },
    send,
    command,
  };
}
