export type NotificationSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: string;
};

function applicationKey(publicKey: string) {
  return Uint8Array.from(
    atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (character) => character.charCodeAt(0),
  );
}

export function notificationKeyMatches(
  subscription: PushSubscription,
  publicKey: string,
) {
  const existing = subscription.options.applicationServerKey;
  if (!existing) return false;
  const expected = applicationKey(publicKey);
  const actual = new Uint8Array(existing);
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

// Browser permission and service-worker promises cannot be cancelled themselves.
// Stop their continuations after navigation and bound waits for a stalled worker.
export function waitForPush<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeout = 12000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Notification operation aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new DOMException("Notification operation timed out", "TimeoutError"),
      );
    }, timeout);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export async function enableNotifications({
  requestPermission,
  registration,
  publicKey,
  locale,
  signal,
  save,
}: {
  requestPermission: () => Promise<NotificationPermission>;
  registration: ServiceWorkerRegistration;
  publicKey: string;
  locale: string;
  signal: AbortSignal;
  save: (subscription: NotificationSubscription) => Promise<unknown>;
}): Promise<"enabled" | "off" | "denied"> {
  signal.throwIfAborted();
  // Call synchronously from the click, before any browser or server await.
  const permission = await waitForPush(requestPermission(), signal, 60000);
  if (permission !== "granted")
    return permission === "denied" ? "denied" : "off";
  let subscription = await waitForPush(
    registration.pushManager.getSubscription(),
    signal,
  );
  signal.throwIfAborted();
  if (subscription && !notificationKeyMatches(subscription, publicKey)) {
    // A restored database can have another application key. Replace that old
    // browser subscription only during this explicit enable action.
    const removed = await waitForPush(subscription.unsubscribe(), signal);
    signal.throwIfAborted();
    if (!removed)
      throw new DOMException(
        "Old push subscription could not be replaced",
        "InvalidStateError",
      );
    subscription = null;
  }
  if (!subscription) {
    subscription = await waitForPush(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(publicKey),
      }),
      signal,
    );
  }
  signal.throwIfAborted();
  const serialized = subscription.toJSON();
  if (
    !serialized.endpoint ||
    !serialized.keys?.p256dh ||
    !serialized.keys.auth
  ) {
    throw new DOMException("Incomplete push subscription", "DataError");
  }
  // Keep an existing browser subscription after a failed save so retrying cannot
  // create duplicate endpoints or remove another session's registration.
  await save({
    endpoint: serialized.endpoint,
    keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
    locale,
  });
  signal.throwIfAborted();
  return "enabled";
}
