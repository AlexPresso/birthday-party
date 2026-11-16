import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  activate,
  bootstrapHost,
  invitationToken,
  mutationHeaders,
  newClient,
  shareSession,
} from "./support/party";
import { openSettingsSection } from "./support/settings";
import { welcomeControls, type WelcomeStep } from "./support/welcome";

let host: APIRequestContext;
const { state, saveSteps } = welcomeControls(() => host);

test.use({ locale: "fr-CH", viewport: { width: 1280, height: 900 } });

test.beforeAll(async () => {
  host = await bootstrapHost("Host Tools Test Host");
});

test.afterAll(async () => {
  await host?.dispose();
});

async function createGuest(name: string, phone = "") {
  const response = await host.post("/api/admin/guests", {
    data: { name, phone },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    guest: { id: number };
    invitationUrl: string;
  };
}

async function previewStatus(token: string) {
  return (
    await host.post("/api/invitations/preview", {
      headers: mutationHeaders,
      data: { token },
    })
  ).status();
}

test("a guest unfolds under their own row and folds back", async ({
  page,
  context,
}) => {
  await createGuest("Unfolding Guest", "+41 79 222 33 44");
  await shareSession(context, host);
  await openSettingsSection(page, "guests");
  const row = page.locator(".guest-list > li", { hasText: "Unfolding Guest" });
  const name = row.getByRole("button", { name: "Modifier Unfolding Guest" });
  await name.click();
  await expect(name).toHaveAttribute("aria-expanded", "true");
  const panel = row.locator(".invitation-result");
  await expect(panel.getByLabel("Téléphone (WhatsApp)")).toHaveValue(
    "+41792223344",
  );
  await expect(page.locator(".invitation-result")).toHaveCount(1);
  await name.click();
  await expect(name).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".invitation-result")).toHaveCount(0);
});

test("bulk WhatsApp invitations skip guests who came in and name those without a number", async ({
  page,
  context,
}) => {
  const first = await createGuest("Bulk Ana", "+41 79 300 00 01");
  await createGuest("Bulk Ben", "+41 79 300 00 02");
  await createGuest("Bulk Cleo");
  const entered = await createGuest("Bulk Dan", "+41 79 300 00 04");
  const visitor = await newClient();
  await activate(visitor, entered.invitationUrl);
  await visitor.dispose();

  await shareSession(context, host);
  await openSettingsSection(page, "guests");
  await page
    .getByRole("button", { name: "Envoyer les invitations WhatsApp" })
    .click();
  const bulk = page.locator(".bulk-whatsapp");
  await expect(bulk.locator(".bulk-whatsapp-missing")).toContainText(
    "Bulk Cleo",
  );
  await expect(bulk.locator(".bulk-whatsapp-missing")).not.toContainText(
    "Bulk Ana",
  );
  const send = bulk.getByRole("link", { name: "Envoyer sur WhatsApp" });
  const current = bulk.locator(".bulk-whatsapp-guest strong");
  // Other specs' guests may wait too: walk the list and keep what it shows.
  const seen = new Map<string, string>();
  const end = bulk.getByText("C’était le dernier invité.");
  while (!(await end.count())) {
    await expect(send).toHaveAttribute("href", /^whatsapp:/);
    const name = (await current.textContent()) ?? "";
    seen.set(name, (await send.getAttribute("href")) ?? "");
    // The test browser has no WhatsApp: keep the page where it is.
    await send.evaluate((anchor) =>
      anchor.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      }),
    );
    await send.click();
    // The next guest, or the end of the list, takes the place.
    await expect(bulk.locator(".bulk-whatsapp-guest")).not.toContainText(name);
  }
  await expect(bulk).toContainText("C’était le dernier invité.");
  expect(seen.has("Bulk Ana") && seen.has("Bulk Ben")).toBe(true);
  expect(seen.has("Bulk Dan") || seen.has("Bulk Cleo")).toBe(false);

  const href = new URL(seen.get("Bulk Ana")!);
  expect(href.protocol).toBe("whatsapp:");
  expect(href.searchParams.get("phone")).toBe("41793000001");
  const text = href.searchParams.get("text")!;
  const sent = text.match(/https?:\/\/\S+#token=[A-Za-z0-9_-]+/)![0];
  // The message carries a new link; the one made with the guest no longer works.
  expect(await previewStatus(invitationToken(sent))).toBe(200);
  expect(await previewStatus(invitationToken(first.invitationUrl))).toBe(401);

  // Going back shows the same guest and the same link again.
  await bulk.getByRole("button", { name: "Précédent" }).click();
  const last = (await current.textContent()) ?? "";
  await expect(send).toHaveAttribute("href", seen.get(last)!);
});

test("the location opens the host's map from the programme", async ({
  page,
  context,
}) => {
  const original = await (await host.get("/api/party")).json();
  try {
    const saved = await host.patch("/api/admin/party", {
      data: {
        ...original,
        location: "Salle des fêtes",
        mapUrl: "https://maps.app.goo.gl/test",
      },
    });
    expect(saved.status()).toBe(200);
    await shareSession(context, host);
    await page.goto("/programme");
    const location = page.getByRole("link", { name: "Salle des fêtes" });
    await expect(location).toHaveAttribute(
      "href",
      "https://maps.app.goo.gl/test",
    );
    await expect(location).toHaveAttribute("target", "_blank");
    await expect(location).toHaveAttribute("rel", "noopener noreferrer");
  } finally {
    await host.patch("/api/admin/party", { data: original });
  }
});

test("the welcome preview shows the draft as guests will see it without touching the server", async ({
  page,
  context,
}) => {
  const previous = (await state()).steps;
  const steps: WelcomeStep[] = [
    {
      widgets: [
        { type: "title", text: "Preview welcome title" },
        { type: "rules", rules: ["Preview rule"] },
      ],
    },
    {
      widgets: [
        { type: "profile_photo" },
        { type: "media_upload", mediaUpload: { categoryId: null } },
      ],
    },
  ];
  try {
    await saveSteps(steps);
    await shareSession(context, host);
    await openSettingsSection(page, "welcome");
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) requests.push(url.pathname);
    });
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    const preview = page.locator("dialog.welcome-preview");
    await expect(
      preview.getByRole("heading", { name: "Preview welcome title" }),
    ).toBeVisible();
    await preview.getByRole("checkbox", { name: "Preview rule" }).check();
    await preview.getByRole("button", { name: "Suivant" }).click();
    await expect(preview.getByText("Étape 2")).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Choisir une photo" }),
    ).toBeDisabled();
    await expect(
      preview.getByRole("button", { name: "Ajouter des médias" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    expect(requests).toEqual([]);
  } finally {
    await saveSteps(previous);
  }
});

test("an invitation signs the guest in at once and counts down until the party starts", async ({
  page,
}) => {
  const party = await (await host.get("/api/party")).json();
  const configuration = await (await host.get("/api/admin/config")).json();
  try {
    expect(
      (
        await host.patch("/api/admin/party", {
          data: {
            ...party,
            date: "2099-06-05T16:30:00Z",
            location: "Grange du Moulin",
            mapUrl: "https://maps.app.goo.gl/waiting",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await host.put("/api/admin/config", {
          data: {
            ...configuration,
            waitingMessage: "Le bus part à 18 h.\nPrends une veste !",
          },
        })
      ).status(),
    ).toBe(200);
    const guest = await createGuest("Early Reader");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guest.invitationUrl);
    await expect(
      page.getByRole("heading", { name: "Early Reader, tu es de la fête." }),
    ).toBeVisible();
    // The link is spent at once and leaves the address bar.
    await expect(page).toHaveURL(/\/invitation$/);
    expect(await previewStatus(invitationToken(guest.invitationUrl))).toBe(401);
    await expect(page.locator(".invitation-message")).toHaveText(
      "Le bus part à 18 h.\nPrends une veste !",
    );
    await expect(
      page.getByRole("link", { name: /Grange du Moulin/ }),
    ).toHaveAttribute("href", "https://maps.app.goo.gl/waiting");
    await expect(page.getByRole("status")).toContainText(/^Encore \d+ jours$/);
    await expect(page.getByRole("button", { name: "Entrer" })).toHaveCount(0);
    await expect(page.getByText("Garde ce lien pour toi.")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("invitation-countdown-mobile.png"),
      fullPage: true,
    });
    // Go keeps the guest out until then, whatever the address.
    await page.goto("/photos");
    await expect(page).toHaveURL(/\/invitation$/);
    expect((await page.request.get("/api/party")).status()).toBe(425);

    // At the party's time, the open page turns its countdown into Enter.
    const soon = new Date(Date.now() + 4_000).toISOString();
    expect(
      (
        await host.patch("/api/admin/party", { data: { ...party, date: soon } })
      ).status(),
    ).toBe(200);
    await page.goto("/invitation");
    await expect(page.getByRole("status")).toContainText(/^Aujourd’hui à/);
    await expect(page.getByRole("button", { name: "Entrer" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Entrer" }).click();
    await expect(page).toHaveURL(/\/(photos|attente)$/);

    // Once the party has started, a returning guest goes straight on.
    expect(
      (
        await host.patch("/api/admin/party", {
          data: { ...party, date: "2000-01-01T00:00:00Z" },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/invitation");
    await expect(page).toHaveURL(/\/(photos|attente)$/);
  } finally {
    await host.put("/api/admin/config", { data: configuration });
    await host.patch("/api/admin/party", { data: party });
  }
});
