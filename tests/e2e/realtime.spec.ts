import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
  type Request,
  type WebSocket,
} from "@playwright/test";
import { execFileSync } from "node:child_process";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};
type Widget =
  | { type: "title"; text: string }
  | { type: "media_upload"; mediaUpload: { categoryId: number | null } };
type Step = { widgets: Widget[] };
type Welcome = {
  open: boolean;
  revision: number;
  currentStep: number;
  required: boolean;
  steps: Step[];
};
type Frame = { type: string; topics?: string[] };
let host: APIRequestContext;
let original: Welcome;
let eventIDs: number[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function state(): Promise<Welcome> {
  const response = await host.get("/api/admin/welcome");
  expect(response.status()).toBe(200);
  return response.json();
}

async function transition(action: "start" | "next" | "open") {
  const { revision } = await state();
  const response = await host.post("/api/admin/welcome/transition", {
    data: { revision, action },
  });
  expect(response.status()).toBe(200);
}

async function save(steps: Step[]) {
  const { revision } = await state();
  expect(
    (
      await host.put("/api/admin/welcome", { data: { revision, steps } })
    ).status(),
  ).toBe(200);
}

async function reset(steps: Step[], required = false) {
  if (!(await state()).open) await transition("open");
  await transition("start");
  await save(steps);
  const { revision } = await state();
  expect(
    (
      await host.patch("/api/admin/welcome/required", {
        data: { revision, required },
      })
    ).status(),
  ).toBe(200);
  await transition("open");
}

async function invite(page: Page, name: string) {
  const created = await host.post("/api/admin/guests", { data: { name } });
  expect(created.status()).toBe(201);
  const invitation = await created.json();
  const accepted = await page.request.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitation.invitationUrl) },
  });
  expect(accepted.status()).toBe(200);
  return invitation.guest as { id: number; name: string };
}

function observe(page: Page) {
  const sockets: { socket: WebSocket; ready: boolean; closed: boolean }[] = [];
  const frames: Frame[] = [];
  const requests: string[] = [];
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

async function imageFile(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#91729d";
    drawing.fillRect(0, 0, 120, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "realtime-welcome.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  };
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Realtime Test Host"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: process.env.BIRTHDAY_E2E_DATA_DIR,
        PUBLIC_URL: baseURL,
        COOKIE_SECURE: "false",
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const match = output.match(
    /http:\/\/localhost:3300\/invitation#token=[A-Za-z0-9_-]+/,
  );
  if (!match)
    throw new Error("Host bootstrap did not return an invitation URL.");
  host = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  expect(
    (
      await host.post("/api/invitations/accept", {
        data: { token: invitationToken(match[0]) },
      })
    ).status(),
  ).toBe(200);
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
  await invite(page, "Realtime Welcome Guest");
  const network = observe(page);
  await page.goto("/attente");
  await expect.poll(network.active).toBe(1);
  await network.settled();
  const idleBefore = network.requests.length;
  await page.waitForTimeout(7000);
  expect(network.requests).toHaveLength(idleBefore);
  await transition("next");
  await expect(
    page.getByRole("button", { name: "Commencer", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: "Share a photo from your table",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
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
  await invite(page, "Realtime Programme Guest");
  const network = observe(page);
  await page.goto("/photos");
  await expect.poll(network.active).toBe(1);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .click();
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
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Paramètres", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
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
  await invite(page, "Realtime Receipt Guest");
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
  await page.screenshot({ path: "artifacts/realtime/queue-retry-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/realtime/queue-retry-desktop.png" });
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

test("reconnection resynchronizes a missed unlock and revoked sessions leave the app", async ({
  page,
  context,
}) => {
  await transition("start");
  await save([
    { widgets: [{ type: "title", text: "Keep your place at the table" }] },
    { widgets: [{ type: "title", text: "PRIVATE-REALTIME-OFFLINE-STEP" }] },
  ]);
  await transition("next");
  const guest = await invite(page, "Realtime Reconnect Guest");
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
      name: "Keep your place at the table",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Suivant", exact: true }),
  ).toBeDisabled();
  const originalProgress = (
    await (await page.request.get("/api/welcome")).json()
  ).progressRevision;
  try {
    await context.setOffline(true);
    await expect.poll(network.active).toBe(0);
    await network.settled();
    const offlineReads = network.requests.length;
    await transition("next");
    await expect(
      page.getByRole("button", { name: "Suivant", exact: true }),
    ).toBeDisabled();
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
  expect(network.readyCount()).toBe(2);
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
    "Realtime reconnect: one missed unlock recovered without moving the guest; server4401 revocation redirected to invitation.",
  );
});
