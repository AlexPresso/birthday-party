import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Request,
  type WebSocket,
} from "@playwright/test";
import { bootstrapHost, mutationHeaders, signInGuest } from "./support/party";
import { canvasImage } from "./support/images";
import {
  welcomeControls,
  type AdminWelcome as Welcome,
} from "./support/welcome";
import { acceptConfirmation } from "./support/confirm";

type Frame = { type: string; topics?: string[] };
let host: APIRequestContext;
let original: Welcome;
const {
  state,
  transition,
  saveSteps: save,
  restoreOpen: reset,
} = welcomeControls(() => host);
let eventIDs: number[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function observe(page: Page) {
  const sockets: { socket: WebSocket; ready: boolean; closed: boolean }[] = [];
  const frames: Frame[] = [];
  const requests: string[] = [];
  const progressRequests: string[] = [];
  const pending = new Set<Request>();
  const watched = new Set(["/api/welcome", "/api/uploads", "/api/programme"]);
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/api/realtime") return;
    const connection = { socket, ready: false, closed: false };
    sockets.push(connection);
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(payload.toString()) as Frame;
      frames.push(frame);
      if (frame.type === "ready") connection.ready = true;
    });
    socket.on("close", () => {
      connection.closed = true;
    });
  });
  page.on("request", (incoming) => {
    const path = new URL(incoming.url()).pathname;
    if (incoming.method() === "POST" && path === "/api/welcome/progress")
      progressRequests.push(path);
    if (incoming.method() === "GET" && watched.has(path)) {
      requests.push(path);
      pending.add(incoming);
    }
  });
  page.on("requestfinished", (outgoing) => pending.delete(outgoing));
  page.on("requestfailed", (outgoing) => pending.delete(outgoing));
  return {
    sockets,
    frames,
    requests,
    progressRequests,
    active: () => sockets.filter((item) => item.ready && !item.closed).length,
    readyCount: () => frames.filter((frame) => frame.type === "ready").length,
    invalidations: (topic: string) =>
      frames.filter(
        (frame) => frame.type === "invalidate" && frame.topics?.includes(topic),
      ).length,
    async settled() {
      await expect.poll(() => pending.size).toBe(0);
      await page.waitForTimeout(150);
    },
  };
}

function expectPrivateFrames(frames: Frame[]) {
  for (const frame of frames) {
    expect(["ready", "invalidate", "heartbeat"]).toContain(frame.type);
    if (frame.type === "invalidate") {
      expect(Object.keys(frame).sort()).toEqual(["topics", "type"]);
      expect(frame.topics?.length).toBeGreaterThan(0);
      for (const topic of frame.topics!)
        expect(["welcome", "uploads", "programme"]).toContain(topic);
    } else expect(Object.keys(frame)).toEqual(["type"]);
  }
}

function imageFile(page: Page) {
  return canvasImage(page, {
    name: "realtime-welcome.png",
    width: 120,
    height: 80,
  });
}

test.beforeAll(async () => {
  host = await bootstrapHost("Realtime Test Host");
  original = await state();
});

test.beforeEach(async () => {
  eventIDs = [];
  await reset([]);
});

test.afterEach(async () => {
  for (const id of eventIDs)
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  await reset(original.steps, original.required);
});

test.afterAll(async () => {
  await host?.dispose();
});

test("welcome and media widgets share one socket and refresh only after changes", async ({
  page,
}) => {
  await transition("start");
  await save([
    {
      widgets: [
        { type: "title", text: "Share a photo from your table" },
        { type: "media_upload", mediaUpload: { categoryId: null } },
        { type: "media_upload", mediaUpload: { categoryId: null } },
      ],
    },
    { widgets: [{ type: "title", text: "PRIVATE-REALTIME-FUTURE-STEP" }] },
  ]);
  await signInGuest(host, page, "Realtime Welcome Guest");
  const network = observe(page);
  await page.goto("/attente");
  await expect.poll(network.active).toBe(1);
  await expect(
    page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
  ).toHaveCount(0);
  await network.settled();
  const idleBefore = network.requests.length;
  await page.waitForTimeout(7000);
  expect(network.requests).toHaveLength(idleBefore);
  await transition("next");
  await expect(
    page.getByRole("heading", {
      name: "Share a photo from your table",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
  ).toHaveCount(0);
  expect(network.progressRequests).toEqual([]);
  const widgets = page.locator(".welcome-media");
  await expect(widgets).toHaveCount(2);
  await expect.poll(network.active).toBe(1);
  expect(network.readyCount()).toBe(1);
  const current = await (await page.request.get("/api/welcome")).json();
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/photos" &&
      response.request().method() === "POST",
  );
  await widgets
    .first()
    .getByLabel("Ajouter des médias", { exact: true })
    .setInputFiles(await imageFile(page));
  await widgets
    .first()
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  const upload = await accepted;
  expect(upload.status()).toBe(202);
  const job = await upload.json();
  await expect(widgets.first().locator(".upload-status.done")).toBeVisible();
  expect(
    (await (await page.request.get(`/api/uploads/${job.id}`)).json()).status,
  ).toBe("ready");
  expect(network.invalidations("uploads")).toBeGreaterThan(0);
  // A second-device upload has no local transfer callback to refresh this tab.
  const externalUpload = await page.request.post("/api/photos", {
    headers: {
      ...mutationHeaders,
      "X-Welcome-Revision": String(current.progressRevision),
      "X-Welcome-Widget-Index": "2",
    },
    multipart: {
      file: { ...(await imageFile(page)), name: "realtime-other-device.png" },
    },
  });
  expect(externalUpload.status()).toBe(202);
  await widgets
    .nth(1)
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  await expect(widgets.nth(1).locator(".upload-status.done")).toBeVisible();
  await expect(
    widgets.nth(1).getByText("realtime-other-device.png", { exact: true }),
  ).toBeVisible();
  await network.settled();
  const uploadReadsBeforeUnlock = network.requests.filter(
    (path) => path === "/api/uploads",
  ).length;
  await transition("next");
  await expect(
    page.getByRole("button", { name: "Suivant", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: "Share a photo from your table",
      exact: true,
    }),
  ).toBeVisible();
  await expect(widgets.first().locator(".upload-status.done")).toBeVisible();
  expect(
    (await (await page.request.get("/api/welcome")).json()).progressRevision,
  ).toBe(current.progressRevision);
  expect(await page.content()).not.toContain("PRIVATE-REALTIME-FUTURE-STEP");
  await network.settled();
  expect(
    network.requests.filter((path) => path === "/api/uploads"),
  ).toHaveLength(uploadReadsBeforeUnlock);
  const completeBefore = network.requests.length;
  await page.waitForTimeout(7000);
  expect(network.requests).toHaveLength(completeBefore);
  expect(network.readyCount()).toBe(1);
  expect(network.progressRequests).toEqual([]);
  expect(network.sockets[0].socket.url()).toBe(
    "ws://localhost:3300/api/realtime",
  );
  expectPrivateFrames(network.frames);
  console.log(
    `Realtime welcome: ${network.readyCount()} connection, ${network.invalidations("welcome")} welcome invalidations, ${network.invalidations("uploads")} upload invalidations; no recurring GETs during two idle windows.`,
  );
});

test("programme edits and scheduled unlocks arrive without minute polling or secret payloads", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInGuest(host, page, "Realtime Programme Guest");
  const network = observe(page);
  await page.goto("/photos");
  await expect.poll(network.active).toBe(1);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true }),
  ).toBeVisible();
  await network.settled();
  const otherReads = network.requests.filter(
    (path) => path !== "/api/programme",
  );
  const input = {
    title: "PRIVATE-REALTIME-SCHEDULED-TITLE",
    description: "PRIVATE-REALTIME-SCHEDULED-DESCRIPTION",
    teaser: "Open the envelope in a moment",
    startsAt: null,
    unlockAt: new Date(Date.now() + 6000).toISOString(),
  };
  const created = await host.post("/api/admin/programme", { data: input });
  expect(created.status()).toBe(201);
  const event = await created.json();
  eventIDs.push(event.id);
  await expect(page.getByText(input.teaser, { exact: true })).toBeVisible();
  await expect(page.getByText(input.title, { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain(input.description);
  await expect(page.getByText(input.title, { exact: true })).toBeVisible();
  await expect(
    page.getByText(input.description, { exact: true }),
  ).toBeVisible();
  const updated = { ...input, title: "Meet beside the cake" };
  expect(
    (
      await host.put(`/api/admin/programme/${event.id}`, { data: updated })
    ).status(),
  ).toBe(200);
  await expect(page.getByText(updated.title, { exact: true })).toBeVisible();
  expect(network.invalidations("programme")).toBeGreaterThanOrEqual(3);
  expect(network.readyCount()).toBe(1);
  await network.settled();
  expect(network.requests.filter((path) => path !== "/api/programme")).toEqual(
    otherReads,
  );
  const idleBefore = network.requests.length;
  const heartbeatsBefore = network.frames.filter(
    (frame) => frame.type === "heartbeat",
  ).length;
  await page.waitForTimeout(65_000);
  expect(network.requests).toHaveLength(idleBefore);
  expect(
    network.frames.filter((frame) => frame.type === "heartbeat").length -
      heartbeatsBefore,
  ).toBeGreaterThanOrEqual(3);
  expect(network.readyCount()).toBe(1);
  expectPrivateFrames(network.frames);
  await page.getByRole("link", { name: /^Profil:/ }).click();
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(page).toHaveURL(/\/invitation(?:\?|$)/);
  await expect.poll(network.active).toBe(0);
  const connections = network.sockets.length;
  await page.waitForTimeout(1500);
  expect(network.sockets).toHaveLength(connections);
  console.log(
    "Realtime programme: host edits and timed unlock received; 65 idle seconds with heartbeats and zero recurring GETs; logout closed the socket.",
  );
});

test("queue reads retry explicitly and socket receipts recover a lost upload response", async ({
  page,
}) => {
  await signInGuest(host, page, "Realtime Receipt Guest");
  let unavailable = true;
  await page.route("**/api/uploads", async (route) => {
    if (unavailable) {
      await route.fulfill({
        status: 503,
        json: { code: "internal_error", error: "Queue unavailable." },
      });
    } else await route.continue();
  });
  const network = observe(page);
  await page.goto("/photos");
  await expect.poll(network.active).toBe(1);
  const retry = page
    .locator(".upload-error")
    .getByRole("button", { name: "Réessayer", exact: true });
  await expect(retry).toBeEnabled();
  await network.settled();
  const failedReads = network.requests.length;
  await page.waitForTimeout(10_500);
  expect(network.requests).toHaveLength(failedReads);
  await page.screenshot({
    path: test.info().outputPath("realtime", "queue-retry-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("realtime", "queue-retry-desktop.png"),
  });
  unavailable = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  let sent = 0;
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent++;
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.abort("failed");
  });
  await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
    ...(await imageFile(page)),
    name: "realtime-recovered.png",
  });
  await page
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  const rows = page
    .locator(".upload-item")
    .filter({ hasText: "realtime-recovered.png" });
  await expect(rows).toHaveText([/realtime-recovered\.png\s*Ajouté/]);
  expect(sent).toBe(1);
  const jobs = await (await page.request.get("/api/uploads")).json();
  expect(jobs.items).toHaveLength(1);
  expect(jobs.items[0].status).toBe("ready");
  await expect(
    page.getByRole("button", {
      name: "Réessayer l'envoi de realtime-recovered.png",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(network.invalidations("uploads")).toBeGreaterThan(0);
});

test("reconnection shows the first step, preserves position on later unlocks, and handles revocation", async ({
  page,
  context,
}) => {
  await transition("start");
  await save([
    { widgets: [{ type: "title", text: "Keep your place at the table" }] },
    { widgets: [{ type: "title", text: "PRIVATE-REALTIME-OFFLINE-STEP" }] },
  ]);
  const guest = await signInGuest(host, page, "Realtime Reconnect Guest");
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url, location.href).pathname === "/api/realtime") {
          this.addEventListener("close", (event) => {
            const codes = JSON.parse(
              sessionStorage.getItem("realtime-close-codes") || "[]",
            );
            codes.push(event.code);
            sessionStorage.setItem(
              "realtime-close-codes",
              JSON.stringify(codes),
            );
          });
        }
      }
    };
  });
  const network = observe(page);
  await page.goto("/attente");
  await expect.poll(network.active).toBe(1);
  await expect(
    page.getByRole("heading", {
      name: `Bienvenue ${guest.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
  ).toHaveCount(0);
  let originalProgress: number | undefined;
  try {
    await context.setOffline(true);
    await expect.poll(network.active).toBe(0);
    await transition("next");
    await context.setOffline(false);
    await expect.poll(network.active).toBe(1);
    await expect(
      page.getByRole("heading", {
        name: "Keep your place at the table",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
    ).toHaveCount(0);
    const first = await (await page.request.get("/api/welcome")).json();
    expect(first.step.position).toBe(1);
    originalProgress = first.progressRevision;
    expect(network.progressRequests).toEqual([]);

    await context.setOffline(true);
    await expect.poll(network.active).toBe(0);
    await network.settled();
    const offlineReads = network.requests.length;
    await transition("next");
    await expect(
      page.getByRole("button", { name: "Suivant", exact: true }),
    ).toHaveCount(0);
    await page.waitForTimeout(3500);
    expect(network.requests).toHaveLength(offlineReads);
    await context.setOffline(false);
    await expect.poll(network.active).toBe(1);
    await expect(
      page.getByRole("button", { name: "Suivant", exact: true }),
    ).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
  expect(network.readyCount()).toBe(3);
  expect(network.progressRequests).toEqual([]);
  await expect(
    page.getByRole("heading", {
      name: "Keep your place at the table",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/welcome")).json()).progressRevision,
  ).toBe(originalProgress);
  expect(await page.content()).not.toContain("PRIVATE-REALTIME-OFFLINE-STEP");
  expect((await host.delete(`/api/admin/guests/${guest.id}`)).status()).toBe(
    204,
  );
  await expect(page).toHaveURL(/\/invitation(?:\?|$)/);
  await expect.poll(network.active).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("realtime-close-codes") || "[]"),
    ),
  ).toContain(4401);
  expectPrivateFrames(network.frames);
  console.log(
    "Realtime reconnect: the first step arrived automatically, a later missed unlock preserved the guest's position, and server4401 revocation redirected to invitation.",
  );
});
