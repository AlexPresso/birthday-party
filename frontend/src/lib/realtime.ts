export type RealtimeTopic = "welcome" | "uploads" | "programme";

type RealtimeMessage =
  | { type: "ready" | "heartbeat" }
  | { type: "invalidate"; topics: RealtimeTopic[] };

const topics = new Set<RealtimeTopic>(["welcome", "uploads", "programme"]);

function parseMessage(data: unknown): RealtimeMessage | null {
  if (typeof data !== "string" || data.length > 1024) return null;
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    if (value.type === "ready" || value.type === "heartbeat")
      return { type: value.type };
    if (
      value.type === "invalidate" &&
      "topics" in value &&
      Array.isArray(value.topics) &&
      value.topics.length > 0 &&
      value.topics.length <= topics.size &&
      value.topics.every((topic) => topics.has(topic))
    )
      return { type: "invalidate", topics: value.topics };
  } catch {
    // A malformed signal never changes application state.
  }
  return null;
}

type Subscriber = {
  topic: RealtimeTopic;
  refresh: () => void;
  connectionChanged: (connected: boolean) => void;
};

export function createRealtimeClient({
  connect,
  available,
  onExpired,
  watch,
  random = Math.random,
}: {
  connect: () => WebSocket;
  available: () => boolean;
  onExpired: () => void;
  watch: (resume: () => void) => () => void;
  random?: () => number;
}) {
  const subscribers = new Set<Subscriber>();
  let socket: WebSocket | undefined;
  let ready = false;
  let hadReady = false;
  let checkedDisconnect = false;
  let expired = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWatching: (() => void) | undefined;

  function disconnect() {
    clearTimeout(heartbeatTimer);
    ready = false;
    if (!socket) return;
    const previous = socket;
    socket = undefined;
    previous.onopen =
      previous.onmessage =
      previous.onerror =
      previous.onclose =
        null;
    previous.close();
  }

  function refresh(affected?: RealtimeTopic[]) {
    for (const subscriber of subscribers)
      if (!affected || affected.includes(subscriber.topic))
        subscriber.refresh();
  }

  function failed() {
    disconnect();
    for (const subscriber of subscribers) subscriber.connectionChanged(false);
    // A session can expire between the disconnect and a failed HTTP upgrade.
    // Check it once per outage through the existing reads, never on every retry.
    if (hadReady && !checkedDisconnect && available()) {
      checkedDisconnect = true;
      refresh();
    }
    if (expired || !subscribers.size || !available()) return;
    clearTimeout(reconnectTimer);
    const maximum = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
    reconnectTimer = setTimeout(start, maximum * (0.75 + random() * 0.25));
  }

  function armHeartbeat(milliseconds: number) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(failed, milliseconds);
  }

  function start() {
    clearTimeout(reconnectTimer);
    if (socket || expired || !subscribers.size || !available()) return;
    try {
      const current = connect();
      socket = current;
      // Cover a stalled handshake as well as a silent established connection.
      armHeartbeat(10000);
      current.onmessage = (event) => {
        if (socket !== current) return;
        const message = parseMessage(event.data);
        if (!message) return;
        armHeartbeat(60000);
        if (message.type === "ready") {
          ready = true;
          hadReady = true;
          checkedDisconnect = false;
          attempts = 0;
          for (const subscriber of subscribers)
            subscriber.connectionChanged(true);
          refresh();
        } else if (message.type === "invalidate" && ready) {
          refresh(message.topics);
        }
      };
      current.onerror = () => {
        if (socket === current) failed();
      };
      current.onclose = (event) => {
        if (socket !== current) return;
        if (event.code === 4401) {
          expired = true;
          disconnect();
          clearTimeout(reconnectTimer);
          onExpired();
        } else failed();
      };
    } catch {
      failed();
    }
  }

  function resume() {
    if (expired) return;
    if (!available()) {
      clearTimeout(reconnectTimer);
      disconnect();
      for (const subscriber of subscribers) subscriber.connectionChanged(false);
    } else {
      refresh();
      start();
    }
  }

  return {
    subscribe(
      topic: RealtimeTopic,
      refresh: () => void,
      connectionChanged: (connected: boolean) => void,
    ) {
      const subscriber = { topic, refresh, connectionChanged };
      subscribers.add(subscriber);
      if (subscribers.size === 1) stopWatching = watch(resume);
      if (ready) connectionChanged(true);
      // Initial HTTP loading also works while the socket is reconnecting.
      if (!expired) {
        refresh();
        start();
      }
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size) return;
        clearTimeout(reconnectTimer);
        disconnect();
        stopWatching?.();
        stopWatching = undefined;
        attempts = 0;
        hadReady = false;
        checkedDisconnect = false;
      };
    },
    retry() {
      if (!ready) start();
    },
  };
}
