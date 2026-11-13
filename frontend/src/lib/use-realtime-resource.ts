"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createInvalidationRefresh } from "./invalidation-refresh";
import { retryRealtime, subscribeRealtime } from "./realtime-browser";
import type { RealtimeTopic } from "./realtime";

const idle = () => Promise.resolve();

/**
 * Keeps one HTTP resource in step with its realtime topic: it reads on the
 * socket handshake, on each invalidation and after a reconnection, coalesces
 * signals that arrive during a request and aborts that request on unmount.
 *
 * `read` and `onError` always run in their latest version. `read` receives the
 * signal to pass to the request and should discard a response it no longer
 * wants. Changing `restartKey` aborts the pending request and reads again.
 */
export function useRealtimeResource({
  topic,
  read,
  onError,
  restartKey,
  hasInitialData = false,
}: {
  topic: RealtimeTopic;
  read: (signal: AbortSignal) => Promise<void>;
  onError: (error: unknown) => void;
  restartKey?: unknown;
  /** The server render supplied current data, so the handshake read suffices. */
  hasInitialData?: boolean;
}) {
  const [connectionFailed, setConnectionFailed] = useState(false);
  const request = useRef(idle);
  const onRead = useEffectEvent(read);
  const onFailure = useEffectEvent(onError);

  useEffect(() => {
    const refresh = createInvalidationRefresh(
      (signal) => onRead(signal),
      (error) => onFailure(error),
    );
    request.current = refresh.request;
    const unsubscribe = subscribeRealtime(
      topic,
      () => void refresh.request(),
      (connected) => setConnectionFailed(!connected),
      { hasInitialData },
    );
    return () => {
      request.current = idle;
      unsubscribe();
      refresh.dispose();
    };
  }, [topic, restartKey, hasInitialData]);

  /** Reads again; resolves once no read is pending. */
  const refresh = useCallback(() => request.current(), []);
  /** Reads again and reconnects the socket without waiting for its backoff. */
  const retry = useCallback(() => {
    retryRealtime();
    return request.current();
  }, []);
  return { connectionFailed, refresh, retry };
}
