import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Configuration,
  Party,
} from "../../frontend/src/features/party/contracts";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};
const viewport = { width: 390, height: 844 };
type Guest = { id: number; name: string };
type Category = { id: number; name: string; isPublic: boolean };
type ProgrammeEvent = { id: number; revision: number };
type Upload = { id: number; status: string; photo: { id: number } | null };

test.use({
  viewport,
  locale: "fr-CH",
  isMobile: true,
  hasTouch: true,
  actionTimeout: 15_000,
});

function invitationToken(url: string) {
  const value = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!value) throw new Error("The invitation URL has no token fragment.");
  return value;
}

async function activate(client: APIRequestContext, invitationUrl: string) {
  const response = await client.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitationUrl) },
  });
  expect(response.status()).toBe(200);
}

async function bootstrapHost() {
  // Only scripts/e2e.mjs supplies both variables for its disposable database.
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  ) {
    throw new Error("Run this fixture through npm run test:e2e.");
  }
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Camille"],
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
  const host = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  await activate(host, match[0]);
  return host;
}

async function fixtureImages(page: Page) {
  const source = readFileSync("docs/design-reference-light.png").toString(
    "base64",
  );
  // These crops contain only the approved mockup's illustrative photographs.
  // They become ordinary private uploads in the disposable test database.
  const images = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const crops = [
      { x: 1074, y: 266, width: 180, height: 180, size: 256 },
      { x: 46, y: 506, width: 100, height: 100, size: 256 },
      { x: 239, y: 504, width: 98, height: 98, size: 256 },
      { x: 30, y: 457, width: 306, height: 310, size: 768 },
      { x: 148, y: 272, width: 65, height: 65, size: 512 },
    ];
    return crops.map(({ x, y, width, height, size }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const drawing = canvas.getContext("2d")!;
      drawing.drawImage(image, x, y, width, height, 0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1];
    });
  }, source);
  return images.map((image) => Buffer.from(image, "base64"));
}

async function saveAvatar(
  client: APIRequestContext,
  buffer: Buffer,
  mimeType: "image/png" | "image/jpeg" = "image/png",
) {
  const response = await client.put("/api/profile/avatar", {
    headers: mutationHeaders,
    multipart: {
      file: {
        name: mimeType === "image/png" ? "portrait.png" : "portrait.jpg",
        mimeType,
        buffer,
      },
    },
  });
  expect(response.status()).toBe(200);
}

async function uploadImage(
  client: APIRequestContext,
  buffer: Buffer,
  categoryId: number | null,
) {
  const query = categoryId === null ? "" : `?categoryId=${categoryId}`;
  const response = await client.post(`/api/photos${query}`, {
    headers: { ...mutationHeaders, "X-Upload-ID": randomUUID() },
    multipart: {
      file: { name: "celebration.png", mimeType: "image/png", buffer },
    },
  });
  expect(response.status()).toBe(202);
  const accepted = (await response.json()) as Upload;
  let job = accepted;
  await expect
    .poll(
      async () => {
        const response = await client.get(`/api/uploads/${accepted.id}`);
        expect(response.status()).toBe(200);
        job = await response.json();
        expect(
          job.status,
          "The fixture image must finish processing.",
        ).not.toBe("failed");
        return job.status;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  expect(job.photo).not.toBeNull();
  return job.photo!.id;
}

function tomorrowAt(time: string) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
  const offset = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Zurich",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName")!
    .value.replace("GMT", "");
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

async function mockBrowserPush(page: Page, host: APIRequestContext) {
  const response = await host.get("/api/notifications");
  expect(response.status()).toBe(200);
  const { publicKey } = await response.json();
  const key = createECDH("prime256v1");
  key.generateKeys();
  const fixture = {
    endpoint: `https://push.example.invalid/${randomUUID()}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  // Replace browser push delivery only; registration and status use the real API.
  await page.addInitScript(
    ({ fixture, publicKey }) => {
      const storageKey = "design-push-state";
      const stored = sessionStorage.getItem(storageKey);
      const state = stored
        ? JSON.parse(stored)
        : {
            permission: "default",
            subscribed: false,
            prompts: 0,
            gestures: [],
          };
      const persist = () =>
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      persist();
      const applicationServerKey = Uint8Array.from(
        atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (character) => character.charCodeAt(0),
      ).buffer;
      Object.defineProperty(Notification, "permission", {
        get: () => state.permission,
      });
      Notification.requestPermission = async () => {
        state.prompts++;
        state.gestures.push(navigator.userActivation.isActive);
        state.permission = "granted";
        persist();
        return state.permission;
      };
      const subscription = {
        endpoint: fixture.endpoint,
        options: { userVisibleOnly: true, applicationServerKey },
        toJSON: () => fixture,
        unsubscribe: async () => {
          state.subscribed = false;
          persist();
          return true;
        },
      } as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () =>
        state.subscribed ? subscription : null;
      PushManager.prototype.subscribe = async () => {
        state.subscribed = true;
        persist();
        return subscription;
      };
    },
    { fixture, publicKey },
  );
  return fixture.endpoint;
}

async function capture(page: Page, theme: "light" | "dark", route: string) {
  await expect(page.locator(".navigation")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    // Warm image resources without mutating server-rendered attributes during hydration.
    await Promise.all(
      Array.from(document.images, async (original) => {
        const image = new Image();
        image.src = original.currentSrc || original.src;
        await image.decode();
      }),
    );
    await Promise.all(
      Array.from(
        document.querySelectorAll(".media-category-portrait"),
        async (portrait) => {
          const background = getComputedStyle(portrait).backgroundImage;
          if (!background.startsWith("url(")) return;
          const image = new Image();
          image.src = background.slice(4, -1).replace(/^["']|["']$/g, "");
          await image.decode();
        },
      ),
    );
    window.scrollTo(0, 0);
  });
  await expect(page.locator(".navigation [data-pending=true]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(16, 15, 14)",
  );
  const profile = page.locator(".navigation a").last();
  await expect(profile).toHaveAttribute("href", "/profil");
  const boxes = await page.locator(".navigation a").evaluateAll((links) =>
    links.map((link) => {
      const { x, width, height } = link.getBoundingClientRect();
      return { x, width, height };
    }),
  );
  expect(
    boxes.every(({ width, height }) => width >= 43.99 && height >= 43.99),
    `Navigation targets must remain accessible at ${page.viewportSize()?.width}px: ${JSON.stringify(boxes)}`,
  ).toBe(true);
  expect(boxes.at(-1)!.x).toBe(Math.max(...boxes.map(({ x }) => x)));
  await page.screenshot({
    path: join("artifacts", "design-fidelity", `${theme}-${route}.png`),
    animations: "disabled",
    caret: "hide",
    style: "nextjs-portal { visibility: hidden !important; }",
  });
}

test("the five screens adapt to phones and desktops in both themes while preserving interactions", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await bootstrapHost();
  const guests: Guest[] = [];
  const clients: APIRequestContext[] = [];
  const categoryFixtures: Category[] = [];
  const eventIds: number[] = [];
  const photoIds: number[] = [];
  const entryIds: number[] = [];
  const adminContext = await browser.newContext({
    baseURL,
    viewport,
    locale: "fr-CH",
    isMobile: true,
    hasTouch: true,
    storageState: await host.storageState(),
  });
  let originalConfiguration: Configuration | undefined;
  let originalParty: Party | undefined;
  let originalHostAvatar: Buffer | null | undefined;
  let endpoint: string | undefined;
  try {
    const welcome = await host.get("/api/admin/welcome");
    expect(welcome.status()).toBe(200);
    expect(await welcome.json()).toMatchObject({ open: true, required: false });
    const configuration = await host.get("/api/admin/config");
    expect(configuration.status()).toBe(200);
    originalConfiguration = await configuration.json();
    const party = await host.get("/api/party");
    expect(party.status()).toBe(200);
    originalParty = await party.json();
    expect(
      (
        await host.put("/api/admin/config", {
          data: {
            ...originalConfiguration,
            age: 30,
            imageSizeMB: 15,
            videoSizeMB: 100,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await host.patch("/api/admin/party", {
          data: {
            title: "Les 30 ans",
            timezone: "Europe/Zurich",
            date: tomorrowAt("18:30"),
            location: "",
          },
        })
      ).status(),
    ).toBe(200);

    const portraits = await fixtureImages(page);
    const profileResponse = await host.get("/api/profile");
    expect(profileResponse.status()).toBe(200);
    const { guest: adminGuest } = await profileResponse.json();
    originalHostAvatar = null;
    if (adminGuest.avatarUrl) {
      const avatar = await host.get(adminGuest.avatarUrl);
      expect(avatar.status()).toBe(200);
      originalHostAvatar = await avatar.body();
    }
    await saveAvatar(host, portraits[0]);
    for (const [index, name] of ["Camille", "Léa", "Hugo"].entries()) {
      const response = await host.post("/api/admin/guests", { data: { name } });
      expect(response.status()).toBe(201);
      const invitation = await response.json();
      guests.push(invitation.guest);
      const client =
        index === 0
          ? page.request
          : await request.newContext({
              baseURL,
              extraHTTPHeaders: mutationHeaders,
            });
      clients.push(client);
      await activate(client, invitation.invitationUrl);
      await saveAvatar(client, portraits[index]);
    }
    for (const name of ["La soirée", "Portraits"]) {
      const response = await host.post("/api/admin/media-categories", {
        data: { name, isPublic: true },
      });
      expect(response.status()).toBe(201);
      categoryFixtures.push(await response.json());
    }
    photoIds.push(await uploadImage(clients[0], portraits[0], null));
    photoIds.push(await uploadImage(clients[1], portraits[4], null));
    photoIds.push(await uploadImage(clients[0], portraits[3], null));
    photoIds.push(
      await uploadImage(clients[1], portraits[4], categoryFixtures[0].id),
    );
    photoIds.push(
      await uploadImage(clients[0], portraits[0], categoryFixtures[1].id),
    );

    for (const entry of [
      {
        title: "On se retrouve",
        description: "Un verre pour commencer.",
        time: "18:30",
        locked: false,
      },
      { title: "À table", description: "", time: "20:00", locked: false },
      {
        title: "Private surprise fixture",
        description: "This detail remains private.",
        time: "21:30",
        locked: true,
      },
    ]) {
      const response = await host.post("/api/admin/programme", {
        data: {
          type: "event",
          title: entry.title,
          description: entry.description,
          teaser: entry.locked ? "Une surprise" : "",
          startsAt: tomorrowAt(entry.time),
          unlockAt: entry.locked ? tomorrowAt(entry.time) : null,
          vote: null,
        },
      });
      expect(response.status()).toBe(201);
      eventIds.push((await response.json()).id);
    }
    const voteResponse = await host.post("/api/admin/programme", {
      data: {
        type: "vote",
        title: "Qui met l’ambiance ?",
        description: "",
        teaser: "",
        startsAt: null,
        unlockAt: null,
        vote: {
          question: "Qui met l’ambiance ?",
          candidateIds: guests.map(({ id }) => id),
          allowSelfVote: false,
        },
      },
    });
    expect(voteResponse.status()).toBe(201);
    const vote = (await voteResponse.json()) as ProgrammeEvent;
    eventIds.push(vote.id);
    expect(
      (
        await host.post(`/api/admin/programme/${vote.id}/vote/state`, {
          data: { status: "open", revision: vote.revision },
        })
      ).status(),
    ).toBe(200);

    for (const [client, body, anonymous] of [
      [clients[2], "Une soirée qu’on n’oubliera pas.", true],
      [clients[1], "On remet ça pour les 40 !", false],
    ] as const) {
      const response = await client.post("/api/guestbook", {
        headers: mutationHeaders,
        data: { body, anonymous },
      });
      expect(response.status()).toBe(201);
      entryIds.push((await response.json()).id);
    }

    endpoint = await mockBrowserPush(page, host);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/parametres");
    await expect(page).toHaveURL(`${baseURL}/profil`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Profil", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".navigation a")).toHaveCount(4);
    await expect(
      page.getByRole("link", { name: "Paramètres", exact: true }),
    ).toHaveCount(0);
    const toggle = page.getByRole("switch", {
      name: "Notifications",
      exact: true,
    });
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    expect(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem("design-push-state")!).prompts,
      ),
    ).toBe(0);
    await toggle.tap();
    await expect(toggle).toBeChecked();
    const registered = await page.request.post("/api/notifications/status", {
      headers: mutationHeaders,
      data: { endpoint },
    });
    expect(registered.status()).toBe(200);
    expect(await registered.json()).toMatchObject({ subscribed: true });
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("design-push-state")!),
      ),
    ).toMatchObject({ prompts: 1, gestures: [true] });

    mkdirSync(join("artifacts", "design-fidelity"), { recursive: true });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/parametres");
    await expect(adminPage.locator(".navigation a")).toHaveCount(5);
    await expect(adminPage.locator(".navigation a").nth(3)).toHaveAttribute(
      "href",
      "/parametres",
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const [route, label, title] of [
        ["photos", "Médias", "Médias"],
        ["programme", "Programme", "Programme"],
        ["livre-d-or", "Livre d'or", "Livre d’or"],
        ["profil", "Profil: Camille", "Profil"],
      ]) {
        const link = page
          .locator(".navigation")
          .getByRole("link", { name: label, exact: true });
        // The Next development insight badge overlaps the first mobile tab.
        if (route === "programme") await link.press("Enter");
        else await link.tap();
        await expect(page).toHaveURL(`${baseURL}/${route}`);
        await expect(
          page.getByRole("heading", { level: 1, name: title, exact: true }),
        ).toBeVisible();
        if (route === "photos" && theme === "light") {
          const queue = page.locator(".upload-queue");
          await expect(queue).toBeHidden();
        }
        if (route === "programme") {
          await expect(
            page.getByRole("heading", {
              name: "Qui met l’ambiance ?",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("article", { name: "Une surprise", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("This detail remains private.", { exact: true }),
          ).toHaveCount(0);
        }
        if (route === "profil") await expect(toggle).toBeChecked();
        // Capture the resting touch state after checking keyboard navigation.
        await page
          .getByRole("heading", { level: 1, name: title, exact: true })
          .tap();
        await capture(page, theme, route);
        if (route === "photos") {
          const posts = page.locator(".media-feed .media-post");
          await expect(
            posts.locator(".media-post-actions a[download]"),
          ).toHaveCount(await posts.count());
          await expect(posts.getByText(/^\d+\s*\/\s*\d+\+?$/)).toHaveCount(0);
          await expect(page.locator(".media-filmstrip")).toHaveCount(0);
          await posts
            .first()
            .locator(".media-post-actions")
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(
              "artifacts",
              "design-fidelity",
              `${theme}-media-details.png`,
            ),
            animations: "disabled",
            caret: "hide",
            style: "nextjs-portal { visibility: hidden !important; }",
          });
        }
      }
      await adminPage.emulateMedia({
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      await expect(
        adminPage.getByRole("heading", {
          level: 1,
          name: "Paramètres",
          exact: true,
        }),
      ).toBeVisible();
      await capture(adminPage, theme, "parametres");
    }

    const desktop = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      locale: "fr-CH",
      storageState: await page.context().storageState(),
    });
    try {
      const desktopPage = await desktop.newPage();
      await adminPage.setViewportSize({ width: 1440, height: 1000 });
      for (const theme of ["light", "dark"] as const) {
        await desktopPage.emulateMedia({ colorScheme: theme });
        await adminPage.emulateMedia({ colorScheme: theme });
        for (const route of ["photos", "programme", "livre-d-or", "profil"]) {
          await desktopPage.goto(`/${route}`);
          await expect(desktopPage.locator("h1")).toBeVisible();
          expect(
            (await desktopPage.locator(".main-content").boundingBox())!.width,
          ).toBeCloseTo(1440 * 0.9);
          await capture(desktopPage, theme, `desktop-${route}`);
        }
        await desktopPage.goto("/photos");
        const posts = desktopPage.locator(".media-feed .media-post");
        await expect(posts.nth(1)).toBeVisible();
        const first = (await posts.nth(0).boundingBox())!;
        const second = (await posts.nth(1).boundingBox())!;
        expect(second.x).toBeGreaterThan(first.x + first.width);
        expect(second.y).toBeCloseTo(first.y);
        await desktopPage.locator(".media-view-switch button").first().click();
        await expect(desktopPage.locator(".media-grid")).toBeVisible();
        await capture(desktopPage, theme, "desktop-media-grid");
        await desktopPage.locator(".media-grid .photo-tile").first().click();
        await expect(desktopPage.getByRole("dialog")).toBeVisible();
        await desktopPage.keyboard.press("Escape");
        await expect(desktopPage.getByRole("dialog")).toBeHidden();

        await desktopPage.goto("/programme");
        await expect(desktopPage.locator(".programme-featured")).toBeVisible();
        const featured = (await desktopPage
          .locator(".programme-featured")
          .boundingBox())!;
        const agenda = (await desktopPage
          .locator(".programme-agenda-item")
          .first()
          .boundingBox())!;
        expect(agenda.x).toBeGreaterThan(featured.x + featured.width);
        await desktopPage.goto("/livre-d-or");
        const draft = desktopPage.locator(".guestbook-compose textarea");
        await draft.fill("A draft retained while resizing.");
        await desktopPage.setViewportSize({ width: 390, height: 844 });
        await expect(draft).toHaveValue("A draft retained while resizing.");
        await desktopPage.setViewportSize({ width: 1440, height: 1000 });
        await expect(draft).toHaveValue("A draft retained while resizing.");

        await adminPage.goto("/parametres");
        await capture(adminPage, theme, "desktop-parametres");
        await expect(adminPage.locator("#party-editor")).toBeVisible();
        const menu = (await adminPage
          .locator('[data-settings-screen="index"]')
          .boundingBox())!;
        const editor = (await adminPage
          .locator("#party-editor")
          .boundingBox())!;
        expect(editor.x).toBeGreaterThan(menu.x + menu.width);
        await capture(adminPage, theme, "desktop-party-settings");
        await adminPage
          .locator('a[href="/parametres?section=uploads"]')
          .click();
        await expect(adminPage.locator("#uploads-editor")).toBeVisible();
        await expect(
          adminPage.locator(".settings-index-heading"),
        ).toBeVisible();
      }
      for (const width of [320, 768, 1024, 1920]) {
        await desktopPage.setViewportSize({ width, height: 1000 });
        await adminPage.setViewportSize({ width, height: 1000 });
        for (const route of ["photos", "programme", "livre-d-or", "profil"]) {
          await desktopPage.goto(`/${route}`);
          await capture(desktopPage, "dark", `${width}-${route}`);
        }
        await adminPage.goto("/parametres");
        await capture(adminPage, "dark", `${width}-parametres`);
      }
    } finally {
      await desktop.close();
    }
    await toggle.tap();
    await expect(toggle).not.toBeChecked();
    const disabled = await page.request.post("/api/notifications/status", {
      headers: mutationHeaders,
      data: { endpoint },
    });
    expect(disabled.status()).toBe(200);
    expect(await disabled.json()).toMatchObject({ subscribed: false });
  } finally {
    if (endpoint)
      await page.request.delete("/api/notifications/subscription", {
        headers: mutationHeaders,
        data: { endpoint },
      });
    for (const id of eventIds) await host.delete(`/api/admin/programme/${id}`);
    for (const id of entryIds) await host.delete(`/api/guestbook/${id}`);
    for (const id of photoIds) await host.delete(`/api/photos/${id}`);
    for (const category of categoryFixtures) {
      await host.put(`/api/admin/media-categories/${category.id}`, {
        data: { name: category.name, isPublic: false },
      });
    }
    for (const guest of guests)
      await host.delete(`/api/admin/guests/${guest.id}`);
    if (originalConfiguration)
      await host.put("/api/admin/config", { data: originalConfiguration });
    if (originalParty)
      await host.patch("/api/admin/party", { data: originalParty });
    if (originalHostAvatar)
      await saveAvatar(host, originalHostAvatar, "image/jpeg");
    else if (originalHostAvatar === null)
      await host.delete("/api/profile/avatar");
    await adminContext.close();
    for (const client of clients.slice(1)) await client.dispose();
    await host.dispose();
  }
});
