import test from "node:test";
import assert from "node:assert/strict";
import {
  enableNotifications,
  waitForPush,
} from "../src/lib/push-notifications.ts";

const publicKey = "B" + "A".repeat(86);
const serialized = {
  endpoint: "https://push.example.test/endpoint",
  keys: { p256dh: "test-public-key", auth: "test-auth-key" },
};
const subscription = {
  toJSON: () => serialized,
  options: {
    applicationServerKey: Uint8Array.from(atob(publicKey), (value) =>
      value.charCodeAt(0),
    ).buffer,
  },
} as unknown as PushSubscription;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function registration(
  getSubscription: () => Promise<PushSubscription | null>,
  subscribe: () => Promise<PushSubscription> = async () => subscription,
) {
  return {
    pushManager: { getSubscription, subscribe },
  } as unknown as ServiceWorkerRegistration;
}

test("notification permission starts in the click and enabling waits for persistence", async () => {
  const permission = deferred<NotificationPermission>();
  const saved = deferred<void>();
  const saving = deferred<void>();
  const calls: string[] = [];
  let finished = false;
  const result = enableNotifications({
    requestPermission: () => {
      calls.push("permission");
      return permission.promise;
    },
    registration: registration(async () => {
      calls.push("subscription");
      return subscription;
    }),
    publicKey,
    locale: "fr",
    signal: new AbortController().signal,
    save: async (value) => {
      assert.deepEqual(value, { ...serialized, locale: "fr" });
      calls.push("save");
      saving.resolve();
      await saved.promise;
    },
  }).then((value) => {
    finished = true;
    return value;
  });
  assert.deepEqual(calls, ["permission"]);
  permission.resolve("granted");
  await saving.promise;
  assert.equal(finished, false);
  saved.resolve();
  assert.equal(await result, "enabled");
  assert.deepEqual(calls, ["permission", "subscription", "save"]);
});

test("denied and dismissed permission never create or save a subscription", async () => {
  for (const permission of ["denied", "default"] as const) {
    let inspected = false;
    const state = await enableNotifications({
      requestPermission: async () => permission,
      registration: registration(async () => {
        inspected = true;
        return subscription;
      }),
      publicKey,
      locale: "en",
      signal: new AbortController().signal,
      save: async () => assert.fail("subscription must not be saved"),
    });
    assert.equal(state, permission === "denied" ? "denied" : "off");
    assert.equal(inspected, false);
  }
});

test("a failed server save retries the existing browser subscription", async () => {
  let existing: PushSubscription | null = null;
  let subscriptions = 0;
  let saves = 0;
  const input = {
    requestPermission: async (): Promise<NotificationPermission> => "granted",
    registration: registration(
      async () => existing,
      async () => {
        subscriptions++;
        existing = subscription;
        return subscription;
      },
    ),
    publicKey,
    locale: "de",
    signal: new AbortController().signal,
    save: async () => {
      if (++saves === 1) throw new Error("Temporary server failure");
    },
  };
  await assert.rejects(enableNotifications(input), /Temporary server failure/);
  assert.equal(await enableNotifications(input), "enabled");
  assert.equal(subscriptions, 1);
  assert.equal(saves, 2);
});

test("navigation during a permission prompt cannot later subscribe or save", async () => {
  const permission = deferred<NotificationPermission>();
  const controller = new AbortController();
  const operation = enableNotifications({
    requestPermission: () => permission.promise,
    registration: registration(async () => {
      assert.fail("stale page must not inspect subscriptions");
    }),
    publicKey,
    locale: "it",
    signal: controller.signal,
    save: async () => assert.fail("stale page must not save"),
  });
  controller.abort();
  permission.resolve("granted");
  await assert.rejects(operation, { name: "AbortError" });
});

test("navigation while the browser creates a subscription prevents server binding", async () => {
  const pending = deferred<PushSubscription>();
  const started = deferred<void>();
  const controller = new AbortController();
  const operation = enableNotifications({
    requestPermission: async () => "granted",
    registration: registration(
      async () => null,
      () => {
        started.resolve();
        return pending.promise;
      },
    ),
    publicKey,
    locale: "es",
    signal: controller.signal,
    save: async () => assert.fail("stale page must not save"),
  });
  await started.promise;
  controller.abort();
  pending.resolve(subscription);
  await assert.rejects(operation, { name: "AbortError" });
});

test("a stalled browser operation has a bounded wait", async () => {
  const stalled = new Promise<never>(() => {});
  await assert.rejects(waitForPush(stalled, new AbortController().signal, 1), {
    name: "TimeoutError",
  });
});

test("an explicit enable replaces an old application key before saving", async () => {
  let removed = false;
  let created = false;
  const old = {
    ...subscription,
    options: { applicationServerKey: new Uint8Array(65).buffer },
    unsubscribe: async () => {
      removed = true;
      return true;
    },
  } as unknown as PushSubscription;
  const result = await enableNotifications({
    requestPermission: async () => "granted",
    registration: registration(
      async () => old,
      async () => {
        assert.equal(removed, true);
        created = true;
        return subscription;
      },
    ),
    publicKey,
    locale: "en",
    signal: new AbortController().signal,
    save: async () => assert.equal(created, true),
  });
  assert.equal(result, "enabled");
});
