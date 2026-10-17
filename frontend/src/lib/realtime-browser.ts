import { returnToInvitation } from "./api";
import { createRealtimeClient, type RealtimeTopic } from "./realtime";

let client: ReturnType<typeof createRealtimeClient> | undefined;

function getClient() {
  client ??= createRealtimeClient({
    connect: () => {
      const url = new URL("/api/realtime", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    },
    available: () => !document.hidden && navigator.onLine,
    onExpired: returnToInvitation,
    watch: (resume) => {
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", resume);
      window.addEventListener("offline", resume);
      window.addEventListener("focus", resume);
      return () => {
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("online", resume);
        window.removeEventListener("offline", resume);
        window.removeEventListener("focus", resume);
      };
    },
  });
  return client;
}

export function subscribeRealtime(
  topic: RealtimeTopic,
  refresh: () => void,
  connectionChanged: (connected: boolean) => void,
) {
  return getClient().subscribe(topic, refresh, connectionChanged);
}

export function retryRealtime() {
  getClient().retry();
}
