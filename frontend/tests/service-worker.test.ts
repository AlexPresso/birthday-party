import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const origin = "https://party.example";
type WindowClient = {
  url: string;
  navigate: (url: string) => Promise<WindowClient | null>;
  focus: () => Promise<unknown>;
};
type WorkerEvent = {
  data?: { text: () => string };
  notification?: { close: () => void; data: unknown };
  waitUntil: (promise: Promise<unknown>) => void;
};

function worker(windows: WindowClient[] = []) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const displayed: { title: string; options: Record<string, string> }[] = [];
  const opened: string[] = [];
  let closed = 0;
  let claimed = 0;
  let installed = 0;
  runInNewContext(source, {
    URL,
    self: {
      location: { origin },
      addEventListener: (
        type: string,
        listener: (event: WorkerEvent) => void,
      ) => listeners.set(type, listener),
      skipWaiting: async () => installed++,
      registration: {
        showNotification: async (
          title: string,
          options: Record<string, string>,
        ) => displayed.push({ title, options }),
      },
      clients: {
        claim: async () => claimed++,
        matchAll: async (options: {
          type: string;
          includeUncontrolled: boolean;
        }) => {
          assert.equal(options.type, "window");
          assert.equal(options.includeUncontrolled, true);
          return windows;
        },
        openWindow: async (url: string) => opened.push(url),
      },
    },
  });
  return {
    displayed,
    opened,
    listeners,
    counts: () => ({ closed, claimed, installed }),
    async dispatch(type: string, raw?: string) {
      const tasks: Promise<unknown>[] = [];
      listeners.get(type)!({
        data: raw === undefined ? undefined : { text: () => raw },
        notification: {
          close: () => closed++,
          data: { url: "https://untrusted.example/private" },
        },
        waitUntil: (promise) => tasks.push(promise),
      });
      await Promise.all(tasks);
    },
  };
}

test("push displays generic localized messages for both welcome events", async () => {
  const sw = worker();
  const titles = {
    en: "Birthday party",
    fr: "La fête",
    de: "Geburtstagsfeier",
    it: "La festa",
    es: "La fiesta",
  };
  for (const [locale, title] of Object.entries(titles)) {
    for (const type of ["welcome_step", "welcome_open"]) {
      await sw.dispatch("push", JSON.stringify({ type, locale }));
      const notification = sw.displayed.at(-1)!;
      assert.equal(notification.title, title);
      assert.ok(notification.options.body.length > 10);
      assert.equal(notification.options.lang, locale);
      assert.equal(notification.options.tag, "birthday-welcome");
      assert.equal(notification.options.icon, "/icons/app-192.png");
      assert.equal(notification.options.data, undefined);
    }
  }
  assert.equal(sw.displayed.length, 10);
});

test("push rejects malformed, oversized and unexpected payload fields", async () => {
  const sw = worker();
  for (const raw of [
    undefined,
    "invalid",
    "null",
    "[]",
    JSON.stringify({
      type: "welcome_step",
      locale: "fr",
      title: "Private title",
    }),
    JSON.stringify({ type: "welcome_step", locale: ["fr"] }),
    JSON.stringify({ type: "welcome_step", locale: "constructor" }),
    JSON.stringify({ type: "welcome_step", locale: "fr-CH" }),
    JSON.stringify({ type: "other", locale: "fr" }),
    JSON.stringify({ type: "welcome_open", locale: "en" }) + " ".repeat(256),
  ]) {
    await sw.dispatch("push", raw);
  }
  assert.equal(sw.displayed.length, 0);
});

test("notification clicks reuse a tab and ignore URLs from notification data", async () => {
  const visited: string[] = [];
  let focused = 0;
  const client: WindowClient = {
    url: `${origin}/photos`,
    navigate: async (url) => {
      visited.push(url);
      return client;
    },
    focus: async () => focused++,
  };
  const sw = worker([client]);
  await sw.dispatch("notificationclick");
  assert.deepEqual(visited, [`${origin}/attente`]);
  assert.equal(focused, 1);
  assert.deepEqual(sw.opened, []);
  assert.equal(sw.counts().closed, 1);
});

test("notification clicks open the welcome route when tabs disappear or none exist", async () => {
  const closedTab: WindowClient = {
    url: `${origin}/parametres`,
    navigate: async () => {
      throw new Error("The tab was closed.");
    },
    focus: async () => assert.fail("A closed tab must not be focused."),
  };
  for (const windows of [
    [],
    [closedTab],
    [{ ...closedTab, url: "https://elsewhere.example" }],
  ]) {
    const sw = worker(windows);
    await sw.dispatch("notificationclick");
    assert.deepEqual(sw.opened, [`${origin}/attente`]);
  }
});

test("notification clicks preserve an active welcome widget by focusing without reload", async () => {
  let focused = 0;
  const sw = worker([
    {
      url: `${origin}/attente`,
      navigate: async () => assert.fail("An active welcome must not reload."),
      focus: async () => focused++,
    },
  ]);
  await sw.dispatch("notificationclick");
  assert.equal(focused, 1);
  assert.deepEqual(sw.opened, []);
});

test("worker activates immediately without intercepting requests or storing private data", async () => {
  const sw = worker();
  await sw.dispatch("install");
  await sw.dispatch("activate");
  assert.deepEqual(sw.counts(), { closed: 0, claimed: 1, installed: 1 });
  assert.deepEqual(
    [...sw.listeners.keys()],
    ["install", "activate", "push", "notificationclick"],
  );
});
