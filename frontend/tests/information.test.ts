import test from "node:test";
import assert from "node:assert/strict";
import {
  adminInformationSchema,
  informationSchema,
} from "../src/features/information/contracts.ts";
import { linkify } from "../src/features/information/linkify.ts";

/** The links of a text, as [displayed text, href] pairs. */
function links(text: string) {
  return linkify(text)
    .filter((segment) => segment.href !== undefined)
    .map((segment) => [segment.text, segment.href]);
}

test("linkify returns the text unchanged, in order, around its links", () => {
  assert.deepEqual(linkify(""), []);
  assert.deepEqual(linkify("Bring a coat.\n\nSee you there!"), [
    { text: "Bring a coat.\n\nSee you there!" },
  ]);
  const text =
    "Map: https://example.com/map\n\nQuestions?\twrite to host@example.com or call +41 79 123 45 67.";
  const segments = linkify(text);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  assert.deepEqual(segments, [
    { text: "Map: " },
    { text: "https://example.com/map", href: "https://example.com/map" },
    { text: "\n\nQuestions?\twrite to " },
    { text: "host@example.com", href: "mailto:host@example.com" },
    { text: " or call " },
    { text: "+41 79 123 45 67", href: "tel:+41791234567" },
    { text: "." },
  ]);
});

test("linkify links http, https and www addresses without trailing punctuation", () => {
  assert.deepEqual(links("http://example.com and HTTPS://Example.com/Path"), [
    ["http://example.com", "http://example.com"],
    ["HTTPS://Example.com/Path", "HTTPS://Example.com/Path"],
  ]);
  assert.deepEqual(links("Go to www.example.com/menu?x=1&y=2#top now"), [
    [
      "www.example.com/menu?x=1&y=2#top",
      "https://www.example.com/menu?x=1&y=2#top",
    ],
  ]);
  for (const mark of [".", ",", ")", "!", "?", ";", ":", "...", ").", "»"]) {
    assert.deepEqual(
      links(`Look at https://example.com/a${mark} Then come.`),
      [["https://example.com/a", "https://example.com/a"]],
      `trailing ${mark}`,
    );
  }
  assert.deepEqual(links("(see www.example.com)"), [
    ["www.example.com", "https://www.example.com"],
  ]);
  // A bracket that the address opens itself belongs to it.
  assert.deepEqual(links("https://example.com/wiki/Cake_(dessert)."), [
    [
      "https://example.com/wiki/Cake_(dessert)",
      "https://example.com/wiki/Cake_(dessert)",
    ],
  ]);
  assert.deepEqual(links("https://example.com/a\nhttps://example.com/b"), [
    ["https://example.com/a", "https://example.com/a"],
    ["https://example.com/b", "https://example.com/b"],
  ]);
});

test("linkify never produces a scheme other than http, https, mailto and tel", () => {
  for (const text of [
    "javascript:alert(1)",
    "JavaScript://www.example.com/%0Aalert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "example.com",
    "https://",
    "www.",
    "notwww.example.com",
  ]) {
    assert.deepEqual(links(text), [], text);
  }
  const schemes = linkify(
    "javascript:alert(1) https://example.com www.example.com a@example.com 0791234567 +41791234567",
  )
    .filter((segment) => segment.href)
    .map((segment) => segment.href!.slice(0, segment.href!.indexOf(":")));
  assert.deepEqual(schemes, ["https", "https", "mailto", "tel", "tel"]);
});

test("linkify links e-mail addresses", () => {
  assert.deepEqual(links("Write to Jane.Doe+party@mail.example.org."), [
    [
      "Jane.Doe+party@mail.example.org",
      "mailto:Jane.Doe+party@mail.example.org",
    ],
  ]);
  assert.deepEqual(links("<host2026@example.com>, thanks"), [
    ["host2026@example.com", "mailto:host2026@example.com"],
  ]);
  assert.deepEqual(links("mailto:host@example.com"), [
    ["host@example.com", "mailto:host@example.com"],
  ]);
  for (const text of ["host@example", "@example.com", "host@", "a @ b.com"]) {
    assert.deepEqual(links(text), [], text);
  }
});

test("linkify links phone numbers that start with + or 0 and have 9 to 15 digits", () => {
  const cases = [
    ["079 123 45 67", "tel:0791234567"],
    ["0791234567", "tel:0791234567"],
    ["079-123-45-67", "tel:0791234567"],
    ["01.23.45.67.89", "tel:0123456789"],
    ["(079) 123 45 67", "tel:0791234567"],
    ["+41 79 123 45 67", "tel:+41791234567"],
    ["+41791234567", "tel:+41791234567"],
    ["+1 (555) 010-9999", "tel:+15550109999"],
    ["+33 (0)1 23 45 67 89", "tel:+33123456789"],
    ["0041 79 123 45 67", "tel:0041791234567"],
    ["012345678", "tel:012345678"],
    ["+123456789012345", "tel:+123456789012345"],
  ] as const;
  for (const [number, href] of cases) {
    assert.deepEqual(links(number), [[number, href]], number);
    assert.deepEqual(
      links(`Call ${number}, please.`),
      [[number, href]],
      `in a sentence: ${number}`,
    );
  }
  assert.deepEqual(links("(+41 79 123 45 67)"), [
    ["+41 79 123 45 67", "tel:+41791234567"],
  ]);
  // Phone keyboards and word processors put no-break spaces in numbers.
  const spaced = ["+41", "79", "123", "45", "67"].join(
    String.fromCharCode(0x202f),
  );
  assert.deepEqual(links(spaced), [[spaced, "tel:+41791234567"]]);
  assert.deepEqual(links("Taxi: 0791234567\n0781234567. Bye"), [
    ["0791234567", "tel:0791234567"],
    ["0781234567", "tel:0781234567"],
  ]);
  for (const text of [
    // Too short, too long, or not starting with + or 0.
    "01234567",
    "0123 456",
    "+1234567",
    "0123456789012345",
    "+1234567890123456",
    "791234567",
    "1234567890",
    // Part of a reference or of a longer series of digits.
    "REF0791234567",
    "order-0791234567",
    "0791234567abc",
    "IBAN CH93 0076 2011 6238 5295 7",
    "IBAN FR76 3000 6000 0112 3456 7890 189",
    "3,000000000",
  ]) {
    assert.deepEqual(links(text), [], text);
  }
});

test("linkify leaves dates and times alone, even beside a phone number", () => {
  for (const text of [
    "14.11.2026",
    "04.11.2026",
    "2026-11-14",
    "04/11/2026",
    "04-11-2026",
    "18:00 - 19:30",
    "09:00 - 09:30",
    "04.11.2026 18:00",
    "04.11.2026 18h30",
    "04.11.2026 09 h",
    "Saturday 14.11.2026, 18:00 - 19:30, then 2026-11-15 00:30",
    "2026",
    "30 CHF",
  ]) {
    assert.deepEqual(links(text), [], text);
  }
  assert.deepEqual(links("079 123 45 67 18:00"), [
    ["079 123 45 67", "tel:0791234567"],
  ]);
  assert.deepEqual(links("0791234567 14.11.2026"), [
    ["0791234567", "tel:0791234567"],
  ]);
  assert.deepEqual(links("14.11.2026: 079 123 45 67"), [
    ["079 123 45 67", "tel:0791234567"],
  ]);
  assert.deepEqual(links("18:00, +41 79 123 45 67 (2026-11-14)"), [
    ["+41 79 123 45 67", "tel:+41791234567"],
  ]);
});

test("information responses carry tabs only while the page is shown", () => {
  const tab = { title: "Useful", body: "Bring a coat.\n\nwww.example.com" };
  assert.deepEqual(informationSchema.parse({ enabled: false, tabs: [] }), {
    enabled: false,
    tabs: [],
  });
  assert.equal(
    informationSchema.safeParse({ enabled: true, tabs: [tab, tab] }).success,
    true,
  );
  // More tabs or longer texts than today's limits still parse: Go owns them.
  assert.equal(
    informationSchema.safeParse({
      enabled: true,
      tabs: Array.from({ length: 20 }, () => ({
        title: "t".repeat(200),
        body: "b".repeat(20_000),
      })),
    }).success,
    true,
  );
  for (const invalid of [
    { enabled: true, tabs: [] },
    { enabled: false, tabs: [tab] },
    { enabled: true },
    { tabs: [tab] },
    { enabled: "true", tabs: [tab] },
    { enabled: true, tabs: [{ title: "Useful" }] },
    { enabled: true, tabs: [{ ...tab, title: " " }] },
    { enabled: true, tabs: [{ ...tab, body: "" }] },
    { enabled: true, tabs: [{ ...tab, body: 4 }] },
    { enabled: true, tabs: {} },
    null,
  ]) {
    assert.equal(
      informationSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  }
});

test("admin information responses keep the saved switch and a revision", () => {
  const tab = { title: "Useful", body: "Bring a coat." };
  for (const valid of [
    { enabled: false, revision: 0, tabs: [] },
    { enabled: true, revision: 1, tabs: [] },
    { enabled: false, revision: 7, tabs: [tab] },
    { enabled: true, revision: 8, tabs: [tab, tab] },
  ]) {
    assert.deepEqual(adminInformationSchema.parse(valid), valid);
  }
  for (const invalid of [
    { enabled: true, tabs: [tab] },
    { enabled: true, revision: -1, tabs: [tab] },
    { enabled: true, revision: 1.5, tabs: [tab] },
    { enabled: true, revision: "1", tabs: [tab] },
    { revision: 1, tabs: [tab] },
    { enabled: true, revision: 1 },
    { enabled: true, revision: 1, tabs: [{ ...tab, title: "" }] },
    { enabled: true, revision: 1, tabs: [{ body: "Bring a coat." }] },
  ]) {
    assert.equal(
      adminInformationSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  }
});
