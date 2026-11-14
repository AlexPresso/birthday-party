import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  bootstrapHost,
  expectNoHorizontalOverflow,
  signInGuest,
} from "./support/party";
import { programme, setVoteStatus, voteSettings } from "./support/votes";
import type { Party } from "../../frontend/src/features/party/contracts";

let host: APIRequestContext;
let originalParty: Party;
const eventIDs: number[] = [];

const accent = "rgb(255, 106, 31)";
const neutral = "rgb(87, 81, 74)";

// The browser sits in Zurich whatever the machine: the party's timezone, not
// the browser's, must decide the day of an event.
test.use({
  viewport: { width: 390, height: 844 },
  locale: "fr-CH",
  timezoneId: "Europe/Zurich",
});

test.beforeAll(async () => {
  host = await bootstrapHost("Programme Days Test Host");
  originalParty = await (await host.get("/api/party")).json();
  // These tests count the days of the whole programme, so they need it to
  // themselves: remove what an earlier spec left in the disposable database.
  for (const { id } of await programme(host, true)) {
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  }
});

test.afterEach(async ({ page }) => {
  // Leave before the events go: a refresh during teardown can hang Chrome.
  await page.goto("about:blank");
  for (const id of eventIDs.splice(0)) {
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  }
});

test.afterAll(async () => {
  // The suite shares one database: hand the party back as it was.
  if (originalParty) {
    const restored = await host.patch("/api/admin/party", {
      data: originalParty,
    });
    expect(restored.status()).toBe(200);
  }
  await host?.dispose();
});

async function setParty(timezone: string, date: string) {
  const saved = await host.patch("/api/admin/party", {
    data: { ...originalParty, timezone, date },
  });
  expect(saved.status()).toBe(200);
}

async function createEvent(
  title: string,
  startsAt: string | null,
  extra: Record<string, unknown> = {},
) {
  const response = await host.post("/api/admin/programme", {
    data: {
      type: "event",
      title,
      description: "",
      teaser: "",
      startsAt,
      unlockAt: null,
      vote: null,
      ...extra,
    },
  });
  expect(response.status()).toBe(201);
  const event = (await response.json()) as { id: number };
  eventIDs.push(event.id);
  return event;
}

const dayHeadings = (page: Page) => page.locator(".programme-day-heading");
const day = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
/** The small date a single-day programme writes above an event's time. */
const eventDates = (page: Page) => page.locator(".programme-time time > span");
const agendaHeading = (page: Page) =>
  page.getByRole("heading", { name: "Les rendez-vous", exact: true });

/** Checks the events of a day, or of the whole agenda, in their order. */
async function expectEvents(scope: Locator, titles: string[]) {
  const events = scope.getByRole("article");
  await expect(events).toHaveCount(titles.length);
  for (const [index, title] of titles.entries()) {
    await expect(events.nth(index)).toHaveAccessibleName(title);
  }
}

/** The space between the first day's last card and the next day's heading. */
function dayGap(page: Page) {
  return page.evaluate(() => {
    const [first, second] = document.querySelectorAll(".programme-day");
    const cards = first.querySelectorAll(".programme-event");
    return (
      second.querySelector(".programme-day-heading")!.getBoundingClientRect()
        .top - cards[cards.length - 1].getBoundingClientRect().bottom
    );
  });
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
}

test("a programme on several days shows each day under its heading, then the events without a time", async ({
  page,
}) => {
  await signInGuest(host, page, "Camille — deux jours");
  // Saturday 14 June 2031 at 18:00 in Zurich.
  await setParty("Europe/Zurich", "2031-06-14T16:00:00Z");
  await createEvent("Le covoiturage", null, {
    description: "On s’organise entre nous.",
  });
  await createEvent("Le brunch", "2031-06-15T09:00:00Z");
  await createEvent("Private surprise fixture", "2031-06-15T12:00:00Z", {
    description: "This detail remains private.",
    teaser: "Une surprise",
    unlockAt: "2031-06-15T12:00:00Z",
  });
  await createEvent("On se retrouve", "2031-06-14T16:30:00Z", {
    description: "Un verre pour commencer.",
  });
  await createEvent("Le gâteau", "2031-06-14T20:00:00Z");
  // A draft vote on the Friday: guests do not see it yet.
  const vote = await createEvent("Le repas de minuit", "2031-06-13T18:00:00Z", {
    type: "vote",
    vote: voteSettings("Qu’est-ce qu’on mange à minuit ?", {
      labels: ["Pizza", "Raclette", "Burgers"],
    }),
  });

  await page.goto("/programme");
  await expect(dayHeadings(page)).toHaveText([
    "Samedi 14 juin",
    "Dimanche 15 juin",
    "Horaire non défini",
  ]);
  await expect(
    page.getByRole("heading", { level: 2 }).and(dayHeadings(page)),
  ).toHaveCount(3);
  await expect(agendaHeading(page)).toHaveCount(0);
  const saturday = day(page, "Samedi 14 juin");
  const sunday = day(page, "Dimanche 15 juin");
  const untimed = day(page, "Horaire non défini");
  await expectEvents(saturday, ["On se retrouve", "Le gâteau"]);
  await expectEvents(sunday, ["Le brunch", "Une surprise"]);
  await expectEvents(untimed, ["Le covoiturage"]);
  for (const region of [saturday, sunday, untimed]) {
    await expect(region.getByRole("list")).toHaveCount(1);
    await expect(region.locator("ol.programme-day-events")).toHaveCount(1);
  }
  await expect(page.locator(".programme-day").last()).toContainText(
    "Le covoiturage",
  );
  await expect(
    page.getByText("This detail remains private.", { exact: true }),
  ).toHaveCount(0);

  // Only the party's day wears the accent; the dots are decoration.
  const dot = (region: Locator) => region.locator(".programme-day-dot");
  await expect(dot(saturday)).toHaveCSS("background-color", accent);
  await expect(dot(sunday)).toHaveCSS("background-color", neutral);
  await expect(dot(untimed)).toHaveCSS("background-color", neutral);
  for (const region of [saturday, sunday, untimed]) {
    await expect(dot(region)).toHaveAttribute("aria-hidden", "true");
  }

  // The heading carries the date: the cards keep the time alone, and the
  // full date stays in the accessible label.
  await expect(eventDates(page)).toHaveCount(0);
  await expect(sunday.locator("time").first()).toHaveText("11:00");
  await expect(sunday.locator("time").first()).toHaveAttribute(
    "aria-label",
    /^15 juin\D+11:00$/,
  );
  await expectNoHorizontalOverflow(page);
  const gap = await dayGap(page);
  expect(gap).toBeGreaterThanOrEqual(20);
  await capture(page, "programme-days-mobile");
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(page);
  await capture(page, "programme-days-desktop");

  // Opening the vote features it live. It was the only event of its day,
  // so that day gets no group, and the cards already shown stay mounted.
  await saturday
    .getByRole("article", { name: "On se retrouve", exact: true })
    .evaluate((card) => card.setAttribute("data-kept", ""));
  await setVoteStatus(host, vote.id, "open");
  const featured = page.locator(".programme-featured");
  await expect(featured).toBeVisible();
  await expect(
    featured.getByRole("link", { name: "Voter", exact: true }),
  ).toBeVisible();
  await expect(dayHeadings(page)).toHaveText([
    "Samedi 14 juin",
    "Dimanche 15 juin",
    "Horaire non défini",
  ]);
  await expectEvents(saturday, ["On se retrouve", "Le gâteau"]);
  await expect(saturday.locator("[data-kept]")).toHaveAccessibleName(
    "On se retrouve",
  );
  // The featured card keeps the left column; the days stack in the right one.
  const card = (await featured.boundingBox())!;
  const days = await page
    .locator(".programme-day")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON()),
    );
  expect(days).toHaveLength(3);
  expect(days[0].top).toBeCloseTo(card.y, 0);
  for (const [index, box] of days.entries()) {
    expect(box.left).toBeGreaterThan(card.x + card.width);
    expect(box.left).toBe(days[0].left);
    expect(box.width).toBe(days[0].width);
    if (index > 0)
      expect(box.top).toBeGreaterThanOrEqual(days[index - 1].bottom);
  }
  // The grid keeps the phone's spacing between two days.
  expect(await dayGap(page)).toBeCloseTo(gap, 0);
  await expectNoHorizontalOverflow(page);
  await capture(page, "programme-days-featured-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await capture(page, "programme-days-featured-mobile");
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
});

test("a programme held on one day keeps its single list without day headings", async ({
  page,
}) => {
  await signInGuest(host, page, "Camille — un jour");
  // The party is on the Friday, the events on the Saturday.
  await setParty("Europe/Zurich", "2031-06-13T16:00:00Z");
  await createEvent("Le covoiturage", null);
  await createEvent("On se retrouve", "2031-06-14T16:30:00Z");
  await createEvent("Le gâteau", "2031-06-14T20:00:00Z");

  await page.goto("/programme");
  await expectEvents(page.locator(".programme-list"), [
    "On se retrouve",
    "Le gâteau",
    "Le covoiturage",
  ]);
  await expect(dayHeadings(page)).toHaveCount(0);
  await expect(page.locator(".programme-day")).toHaveCount(0);
  await expect(page.locator(".programme-list section")).toHaveCount(0);
  await expect(agendaHeading(page)).toHaveCount(1);
  await expect(eventDates(page)).toHaveText(["14 juin", "14 juin"]);

  // A second day arrives while the page is open: the days separate live.
  const brunch = await createEvent("Le brunch", "2031-06-15T09:00:00Z");
  await expect(dayHeadings(page)).toHaveText([
    "Samedi 14 juin",
    "Dimanche 15 juin",
    "Horaire non défini",
  ]);
  await expect(agendaHeading(page)).toHaveCount(0);
  await expect(eventDates(page)).toHaveCount(0);
  await expectEvents(day(page, "Dimanche 15 juin"), ["Le brunch"]);
  // Neither day is the party's.
  await expect(page.locator(".programme-day-dot")).toHaveCount(3);
  for (const dot of await page.locator(".programme-day-dot").all()) {
    await expect(dot).toHaveCSS("background-color", neutral);
  }

  expect(
    (await host.delete(`/api/admin/programme/${brunch.id}`)).status(),
  ).toBe(204);
  eventIDs.splice(eventIDs.indexOf(brunch.id), 1);
  await expect(dayHeadings(page)).toHaveCount(0);
  await expect(agendaHeading(page)).toHaveCount(1);
  await expect(eventDates(page)).toHaveText(["14 juin", "14 juin"]);
});

test("days follow the party's timezone, not the browser's", async ({
  page,
}) => {
  await signInGuest(host, page, "Camille — antipodes");
  // Auckland is ten hours ahead of the browser in June: half an hour past
  // midnight on Sunday there is still Saturday afternoon in Zurich.
  const beforeMidnight = "2031-06-14T11:30:00Z";
  const afterMidnight = "2031-06-14T12:30:00Z";
  await setParty("Pacific/Auckland", afterMidnight);
  await createEvent("Le dernier verre", beforeMidnight);
  await createEvent("Le feu d’artifice", afterMidnight);

  await page.goto("/programme");
  expect(
    await page.evaluate(
      ([first, second]) =>
        new Date(first).toDateString() === new Date(second).toDateString(),
      [beforeMidnight, afterMidnight],
    ),
  ).toBe(true);
  await expect(dayHeadings(page)).toHaveText([
    "Samedi 14 juin",
    "Dimanche 15 juin",
  ]);
  const saturday = day(page, "Samedi 14 juin");
  const sunday = day(page, "Dimanche 15 juin");
  await expectEvents(saturday, ["Le dernier verre"]);
  await expectEvents(sunday, ["Le feu d’artifice"]);
  await expect(saturday.locator("time")).toHaveText("23:30");
  await expect(sunday.locator("time")).toHaveText("00:30");
  await expect(saturday.locator(".programme-day-dot")).toHaveCSS(
    "background-color",
    neutral,
  );
  await expect(sunday.locator(".programme-day-dot")).toHaveCSS(
    "background-color",
    accent,
  );
});
