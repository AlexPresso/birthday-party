import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { detectLocale, locales } from "../src/lib/locale.ts";
import { createTranslator } from "../src/lib/i18n.ts";
import { getMessages } from "../src/lib/dictionaries.ts";
import { birthdayCopy } from "../src/features/party/birthday-copy.ts";
import { formatDate } from "../src/lib/dates.ts";
import {
  ApiError,
  api,
  errorMessage,
  readResponse,
  responseError,
  remove,
} from "../src/lib/api.ts";
import { commonMessages } from "../src/lib/messages/common.ts";
import { adminMessages } from "../src/lib/messages/admin.ts";
import { mediaMessages } from "../src/lib/messages/media.ts";
import { welcomeMessages } from "../src/lib/messages/welcome.ts";
import { profileMessages } from "../src/lib/messages/profile.ts";
import { categoryMessages } from "../src/lib/messages/categories.ts";
import { widgetMessages } from "../src/lib/messages/widgets.ts";
import { slideshowMessages } from "../src/lib/messages/slideshow.ts";
import { notificationMessages } from "../src/lib/messages/notifications.ts";
import { errorMessages } from "../src/lib/messages/errors.ts";
import { activityMessages } from "../src/lib/messages/activities.ts";
import { questionMessages } from "../src/lib/messages/questions.ts";

test("locale negotiation follows language preferences and region variants", () => {
  const cases = [
    ["fr-CH,fr;q=0.9,en;q=0.8", "fr"],
    [" DE-ch , fr;q=0.8", "de"],
    ["it-CH,it;q=0.9", "it"],
    ["es-MX,es;q=0.9", "es"],
    ["en-GB,en;q=0.8", "en"],
    ["fr;q=0.2,de;q=0.9,it;q=0.6", "de"],
    ["ja-JP,pt-BR;q=0.9,it-CH;q=0.8,en;q=0.5", "it"],
    ["de;q=0.7,fr;q=0.7", "de"],
    ["fr;q=0,en;q=0.5,it;q=1", "it"],
    ["fr;q=invalid,de;q=2,es;q=-1,it;q=0.6", "it"],
    ["fr;q=,de;q=NaN,it;q=0.5", "it"],
    ["fr_CH,de--CH,es;q=0.5", "es"],
    ["ja-JP,*;q=0.5", "en"],
    ["ja-JP", "en"],
    ["fr;q=0,de;q=0", "en"],
    ["", "en"],
    [null, "en"],
  ] as const;
  for (const [header, expected] of cases) {
    assert.equal(detectLocale(header), expected, `header: ${header}`);
  }
});

function placeholders(value: string) {
  return [
    ...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
  ].sort();
}

test("all catalogs contain the same nonempty keys and interpolation parameters", () => {
  for (const family of [
    commonMessages,
    adminMessages,
    mediaMessages,
    welcomeMessages,
    profileMessages,
    categoryMessages,
    widgetMessages,
    slideshowMessages,
    notificationMessages,
    activityMessages,
    questionMessages,
    errorMessages,
  ]) {
    const expected = family.en as Record<string, string>;
    for (const locale of locales) {
      const messages = family[locale] as Record<string, string>;
      assert.deepEqual(
        Object.keys(messages).sort(),
        Object.keys(expected).sort(),
        locale,
      );
      for (const [key, message] of Object.entries(messages)) {
        assert.ok(message.trim(), `${locale}: ${key} is empty`);
        assert.deepEqual(
          placeholders(message),
          placeholders(expected[key]),
          `${locale}: ${key}`,
        );
      }
    }
  }
  const expectedKeys = Object.keys(getMessages("en")).sort();
  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(getMessages(locale)).sort(),
      expectedKeys,
      locale,
    );
  }
  const french = getMessages("fr");
  assert.deepEqual(
    [
      french["nav.programme"],
      french["nav.photos"],
      french["nav.guestbook"],
      french["nav.settings"],
    ],
    ["Programme", "Médias", "Livre d'or", "Paramètres"],
  );
});

test("translators replace supplied values without interpreting guest content", () => {
  const t = createTranslator(getMessages("fr"));
  assert.equal(
    t("invitation.hello", { name: "Léa {age}" }),
    "Léa {age}, tu es de la fête.",
  );
  assert.equal(t("invitation.hello", { name: "" }), ", tu es de la fête.");
  assert.equal(t("birthday.title", { age: 0 }), "Les 0 ans");
  assert.equal(t("invitation.hello"), "{name}, tu es de la fête.");
});

test("every backend error code has a translation and the same English fallback", () => {
  const source = readFileSync(
    new URL("../../backend/internal/app/errors.go", import.meta.url),
    "utf8",
  );
  const codes = [...source.matchAll(/"([a-z_]+)":\s+("(?:[^"\\]|\\.)*")/g)];
  assert.ok(codes.length > 0, "backend error catalog is empty");
  for (const [, code, encodedMessage] of codes) {
    const key = code as keyof typeof errorMessages.en;
    assert.equal(errorMessages.en[key], JSON.parse(encodedMessage), code);
    for (const locale of locales) {
      assert.ok(
        errorMessages[locale][key]?.trim(),
        `${locale}: missing ${code}`,
      );
    }
  }
  const english = getMessages("en");
  for (const code of ["upload_type", "upload_size", "upload_empty"] as const) {
    assert.ok(english[`errors.${code}`]);
  }
});

test("API errors use localized codes and ignore raw backend messages", async () => {
  for (const locale of locales) {
    const messages = getMessages(locale);
    const t = createTranslator(messages);
    const body = {
      code: "invitation_unavailable",
      error: "Untranslated diagnostic",
    };
    assert.equal(
      responseError(body, t),
      errorMessages[locale].invitation_unavailable,
    );
    await assert.rejects(
      readResponse(
        Response.json(body, { status: 401 }),
        z.object({ ok: z.boolean() }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.code, "errors.invitation_unavailable");
        assert.equal(
          errorMessage(error, t),
          errorMessages[locale].invitation_unavailable,
        );
        return true;
      },
    );
    for (const invalid of [
      null,
      "error",
      { error: "Raw server failure" },
      { code: 500 },
      { code: "Bad code" },
      { code: "future_error" },
    ]) {
      assert.equal(responseError(invalid, t), messages["common.actionFailed"]);
    }
    assert.equal(
      errorMessage(new ApiError("errors.future_error"), t),
      messages["common.actionFailed"],
    );
    assert.equal(errorMessage(null, t), messages["common.actionFailed"]);
    assert.equal(
      errorMessage(new Error(t("errors.invalid_message")), t),
      messages["errors.invalid_message"],
    );
  }
});

test("unreadable errors and invalid successful responses get translated feedback", async () => {
  const t = createTranslator(getMessages("de"));
  const schema = z.object({ ok: z.boolean() });
  assert.deepEqual(await readResponse(Response.json({ ok: true }), schema), {
    ok: true,
  });
  await assert.rejects(
    readResponse(new Response("upstream failure", { status: 502 }), schema),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(errorMessage(error, t), t("common.actionFailed"));
      return true;
    },
  );
  await assert.rejects(
    readResponse(Response.json({ ok: "yes" }), schema),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(errorMessage(error, t), t("common.invalidResponse"));
      return true;
    },
  );
});

test("network failures are translated while request cancellations remain cancellations", async (context) => {
  const t = createTranslator(getMessages("it"));
  const schema = z.object({ ok: z.boolean() });
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("English browser diagnostic");
  });
  await assert.rejects(
    api("/invitations/preview", schema),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(errorMessage(error, t), t("common.connectionFailed"));
      return true;
    },
  );
  const aborted = new DOMException("Aborted", "AbortError");
  fetchMock.mock.mockImplementation(async () => {
    throw aborted;
  });
  await assert.rejects(
    api("/invitations/preview", schema),
    (error: unknown) => error === aborted,
  );
});

test("subscription removal sends its endpoint and accepts an empty successful response", async (context) => {
  const controller = new AbortController();
  const body = { endpoint: "https://push.example.test/endpoint" };
  const fetchMock = context.mock.method(
    globalThis,
    "fetch",
    async (_path: string, options: RequestInit) => {
      assert.equal(options.method, "DELETE");
      assert.equal(options.signal, controller.signal);
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.body, JSON.stringify(body));
      assert.equal(
        new Headers(options.headers).get("Content-Type"),
        "application/json",
      );
      return new Response(null, { status: 204 });
    },
  );
  await remove("/notifications/subscription", "DELETE", {
    body,
    signal: controller.signal,
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("date labels use the selected language and party timezone without zone suffixes", () => {
  const instant = "2026-07-01T00:30:00Z";
  const months = {
    en: "July",
    fr: "juillet",
    de: "Juli",
    it: "luglio",
    es: "julio",
  };
  for (const locale of locales) {
    const value = formatDate(instant, "Europe/Zurich", false, locale);
    assert.ok(value.includes(months[locale]), `${locale}: ${value}`);
    assert.match(value, /\b1\b/);
    assert.doesNotMatch(value, /\d:\d/);
  }
  assert.match(formatDate(instant, "Europe/Zurich", true, "fr"), /02:30$/);
  const previousDay = formatDate(instant, "America/Los_Angeles", true, "fr");
  assert.match(previousDay, /30 juin/);
  assert.match(previousDay, /17:30$/);
});

const birthdayConfiguration = {
  age: 30,
  invitation: {
    title: null,
    description: null,
    locales: {
      en: { title: null, description: null },
      fr: { title: null, description: null },
      de: { title: null, description: null },
      it: { title: null, description: null },
      es: { title: null, description: null },
    },
  },
};

test("birthday defaults follow the selected language and saved age", () => {
  for (const locale of locales) {
    const t = createTranslator(getMessages(locale));
    const defaults = birthdayCopy(birthdayConfiguration, locale, t);
    assert.equal(defaults.age, 30);
    assert.equal(defaults.title, t("birthday.title", { age: 30 }));
    assert.equal(defaults.description, t("birthday.description"));
    const configured = birthdayCopy(
      { ...birthdayConfiguration, age: 42 },
      locale,
      t,
    );
    assert.equal(configured.age, 42);
    assert.equal(configured.title, t("birthday.title", { age: 42 }));
    for (const age of [1, 150]) {
      assert.equal(
        birthdayCopy({ ...birthdayConfiguration, age }, locale, t).age,
        age,
        String(age),
      );
    }
    assert.equal(
      birthdayCopy({ ...birthdayConfiguration, age: 1 }, locale, t).title,
      t("birthday.titleOne", { age: 1 }),
    );
  }
});

test("localized invitation overrides take priority and preserve explicitly empty text", () => {
  const configuration = {
    ...birthdayConfiguration,
    invitation: {
      title: "  Alex’s birthday  ",
      description: "  See you on Saturday.  ",
      locales: {
        ...birthdayConfiguration.invitation.locales,
        de: {
          title: "  Alex feiert Geburtstag  ",
          description: "  Bis Samstag.  ",
        },
        fr: { title: "   ", description: "" },
      },
    },
  };
  const german = birthdayCopy(
    configuration,
    "de",
    createTranslator(getMessages("de")),
  );
  assert.equal(german.title, "Alex feiert Geburtstag");
  assert.equal(german.description, "Bis Samstag.");
  const italian = birthdayCopy(
    configuration,
    "it",
    createTranslator(getMessages("it")),
  );
  assert.equal(italian.title, "Alex’s birthday");
  assert.equal(italian.description, "See you on Saturday.");
  const french = birthdayCopy(
    configuration,
    "fr",
    createTranslator(getMessages("fr")),
  );
  assert.equal(french.title, "");
  assert.equal(french.description, "");
  const english = birthdayCopy(
    {
      ...birthdayConfiguration,
      invitation: {
        ...birthdayConfiguration.invitation,
        title: "",
        description: " ",
      },
    },
    "en",
    createTranslator(getMessages("en")),
  );
  assert.equal(english.title, "");
  assert.equal(english.description, "");
});
