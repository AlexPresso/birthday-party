import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getMessages } from "../src/lib/dictionaries.ts";
import { locales } from "../src/lib/locale.ts";

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
  notification?: { close: () => void; data: unknown; tag: string };
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
    async dispatch(type: string, raw?: string, tag = "birthday-welcome") {
      const tasks: Promise<unknown>[] = [];
      listeners.get(type)!({
        data: raw === undefined ? undefined : { text: () => raw },
        notification: {
          close: () => closed++,
          data: { url: "https://untrusted.example/private" },
          tag,
        },
        waitUntil: (promise) => tasks.push(promise),
      });
      await Promise.all(tasks);
    },
  };
}

const programmePush = {
  type: "programme_start",
  locale: "fr",
  title: "Le gâteau",
  eventId: 12,
};

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
    JSON.stringify({ type: "welcome_open", locale: "en" }) + " ".repeat(2048),
    JSON.stringify({ type: "programme_start", locale: "fr" }),
    JSON.stringify({ type: "programme_start", locale: "fr", title: "Cake" }),
    JSON.stringify({ type: "programme_start", locale: "fr", eventId: 12 }),
    JSON.stringify({ ...programmePush, title: null }),
    JSON.stringify({ ...programmePush, title: ["Cake"] }),
    JSON.stringify({ ...programmePush, eventId: "12" }),
    JSON.stringify({ ...programmePush, eventId: 0 }),
    JSON.stringify({ ...programmePush, eventId: 1.5 }),
    JSON.stringify({ ...programmePush, locale: "fr-CH" }),
    JSON.stringify({ ...programmePush, type: "programme_vote" }),
    JSON.stringify({ ...programmePush, type: "welcome_step" }),
    JSON.stringify({ ...programmePush, description: "Private details" }),
    JSON.stringify({ ...programmePush, title: "x".repeat(2048) }),
  ]) {
    await sw.dispatch("push", raw);
  }
  assert.equal(sw.displayed.length, 0);
});

test("programme pushes show the event's name as written with a short localized body", async () => {
  const sw = worker();
  const bodies = {
    en: ["It’s starting.", "It’s revealed."],
    fr: ["Ça commence.", "C’est dévoilé."],
    de: ["Es geht los.", "Nicht mehr geheim."],
    it: ["Si comincia.", "È svelato."],
    es: ["Ya empieza.", "Ya se ha revelado."],
  };
  // The name stays in the host's words whatever the guest's language.
  const title = "Le gâteau & les « bougies »";
  for (const [locale, [start, unlock]] of Object.entries(bodies)) {
    for (const [type, body] of [
      ["programme_start", start],
      ["programme_unlock", unlock],
    ]) {
      await sw.dispatch(
        "push",
        JSON.stringify({ type, locale, title, eventId: 12 }),
      );
      const notification = sw.displayed.at(-1)!;
      assert.equal(notification.title, title);
      assert.deepEqual(
        { ...notification.options },
        {
          body,
          lang: locale,
          icon: "/icons/app-192.png",
          tag: `birthday-programme-12-${type}`,
        },
      );
    }
  }
  assert.equal(sw.displayed.length, 10);
});

test("a programme push without a name uses the Schedule's surprise placeholder", async () => {
  const sw = worker();
  for (const locale of locales) {
    await sw.dispatch(
      "push",
      JSON.stringify({ ...programmePush, locale, title: "" }),
    );
    const notification = sw.displayed.at(-1)!;
    assert.equal(notification.title, getMessages(locale)["programme.surprise"]);
    assert.ok(notification.options.body);
  }
  assert.equal(sw.displayed.length, locales.length);
});

test("programme notifications of different events and moments do not replace each other", async () => {
  const sw = worker();
  for (const [type, eventId] of [
    ["programme_start", 12],
    ["programme_unlock", 12],
    ["programme_start", 13],
    ["programme_start", 12],
  ] as const) {
    await sw.dispatch(
      "push",
      JSON.stringify({ ...programmePush, type, eventId }),
    );
  }
  const tags = sw.displayed.map(({ options }) => options.tag);
  assert.equal(new Set(tags).size, 3);
  assert.equal(tags[0], tags[3]);
  assert.ok(!tags.includes("birthday-welcome"));
});

test("the longest event name still fits once Go has escaped it", async () => {
  const sw = worker();
  const title = "<".repeat(160);
  // Go writes <, > and & as six characters each; the padding stands in for it.
  const raw = JSON.stringify({ ...programmePush, title }).padEnd(100 + 160 * 6);
  await sw.dispatch("push", raw);
  assert.equal(sw.displayed.at(-1)?.title, title);
});

test("a click on a programme notification opens the Schedule and reuses a tab", async () => {
  const tag = "birthday-programme-12-programme_start";
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
  const reused = worker([client]);
  await reused.dispatch("notificationclick", undefined, tag);
  assert.deepEqual(visited, [`${origin}/programme`]);
  assert.equal(focused, 1);
  assert.deepEqual(reused.opened, []);
  assert.equal(reused.counts().closed, 1);

  const shown = worker([
    {
      url: `${origin}/programme`,
      navigate: async () => assert.fail("The open Schedule must not reload."),
      focus: async () => focused++,
    },
  ]);
  await shown.dispatch("notificationclick", undefined, tag);
  assert.equal(focused, 2);
  assert.deepEqual(shown.opened, []);

  const none = worker();
  await none.dispatch("notificationclick", undefined, tag);
  assert.deepEqual(none.opened, [`${origin}/programme`]);
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

test("storage alerts show a localized sentence and open the storage settings", async () => {
  const sw = worker();
  for (const locale of locales) {
    for (const type of ["storage_warning", "storage_full"]) {
      await sw.dispatch("push", JSON.stringify({ type, locale }));
      const notification = sw.displayed.at(-1)!;
      assert.ok(notification.title.length > 3);
      assert.ok(notification.options.body.length > 20);
      assert.equal(notification.options.tag, "birthday-storage");
    }
  }
  assert.equal(sw.displayed.length, locales.length * 2);
  // A storage alert names nothing: any extra field is refused.
  await sw.dispatch(
    "push",
    JSON.stringify({ type: "storage_full", locale: "fr", title: "x" }),
  );
  assert.equal(sw.displayed.length, locales.length * 2);

  const settings = `${origin}/parametres?section=storage`;
  let focused = 0;
  const shown = worker([
    {
      url: settings,
      navigate: async () => assert.fail("The open page must not reload."),
      focus: async () => focused++,
    },
  ]);
  await shown.dispatch("notificationclick", undefined, "birthday-storage");
  assert.equal(focused, 1);
  const none = worker();
  await none.dispatch("notificationclick", undefined, "birthday-storage");
  assert.deepEqual(none.opened, [settings]);
});
