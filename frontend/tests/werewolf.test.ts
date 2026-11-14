import test from "node:test";
import assert from "node:assert/strict";
import {
  eventSchema,
  werewolfSchema,
  werewolfSummarySchema,
  type PartyEvent,
  type Werewolf,
  type WerewolfPlayer,
  type WerewolfRole,
} from "../src/features/programme/contracts.ts";
import {
  editedElsewhere,
  eventDraft,
  eventRequestBody,
  lockedGameMaster,
  mergeSavedDraft,
  newEventDraft,
  sameDraft,
} from "../src/features/programme/event-draft.ts";
import {
  boardRole,
  codePoints,
  completeWithVillagers,
  countLine,
  mergeSavedRoles,
  playerCount,
  playersByFate,
  roleDrafts,
  roleInputs,
  roleText,
  roleTotal,
  sameRoleInputs,
  startObstacle,
  unnamedRole,
  type RoleDraft,
} from "../src/features/programme/werewolf-model.ts";
import { getMessages } from "../src/lib/dictionaries.ts";
import { createTranslator } from "../src/lib/i18n.ts";
import { locales } from "../src/lib/locale.ts";

const french = createTranslator(getMessages("fr"));
const english = createTranslator(getMessages("en"));

type Person = Pick<WerewolfPlayer, "id" | "name" | "avatarUrl">;

const alex: Person = {
  id: 1,
  name: "Alex",
  avatarUrl: "/api/guests/1/avatar?v=2",
};
const sam: Person = { id: 2, name: "Sam", avatarUrl: null };
const robin: Person = { id: 3, name: "Robin", avatarUrl: null };

function player(
  person: Person,
  changes: Partial<WerewolfPlayer> = {},
): WerewolfPlayer {
  return { ...person, alive: true, mayor: false, role: null, ...changes };
}

const seer = { key: "seer", name: null, description: null } as const;
const jester = {
  key: null,
  name: "Bouffon",
  description: "Fais-toi éliminer.",
};

const roles: WerewolfRole[] = [
  { id: 1, key: "werewolf", name: null, description: null, count: 1 },
  { id: 2, key: "villager", name: null, description: null, count: 0 },
  { id: 3, key: "seer", name: null, description: "Tu vois tout.", count: 1 },
  { id: 4, ...jester, count: 1 },
];

// A living player, by day: their own role and nobody else's.
const playerView: Werewolf = {
  status: "running",
  revision: 7,
  gameMaster: alex,
  isGameMaster: false,
  joined: true,
  hideRolesOfDead: false,
  ghostMessages: true,
  phase: "day",
  players: [
    player(sam, { mayor: true }),
    player(robin, { alive: false, role: jester }),
  ],
  myRole: seer,
  canWriteMessage: false,
  myMessage: null,
  mayorMessage: { from: robin, text: "Méfie-toi de Sam." },
  roles: null,
  messages: null,
};

const masterView: Werewolf = {
  ...playerView,
  isGameMaster: true,
  joined: false,
  players: [
    player(sam, { mayor: true, role: seer }),
    player(robin, { alive: false, role: jester }),
  ],
  myRole: null,
  mayorMessage: null,
  roles,
  messages: [{ from: robin, text: "Méfie-toi de Sam.", delivered: true }],
};

const event: PartyEvent = {
  id: 12,
  type: "werewolf",
  revision: 2,
  title: "Loup-garou",
  description: "",
  teaser: "",
  startsAt: null,
  unlockAt: null,
  locked: false,
  vote: null,
  werewolf: { status: "lobby", gameMaster: alex, players: 4 },
};

test("a game is read as its viewer may see it, without frontend ceilings", () => {
  assert.deepEqual(werewolfSchema.parse(playerView), playerView);
  assert.deepEqual(werewolfSchema.parse(masterView), masterView);
  const crowd = Array.from({ length: 61 }, (_, index) =>
    player({ id: index + 1, name: `Guest ${index + 1}`, avatarUrl: null }),
  );
  for (const valid of [
    { ...playerView, status: "lobby", revision: 0, players: [], myRole: null },
    { ...playerView, players: crowd },
    { ...playerView, myRole: { ...jester, name: "x".repeat(41) } },
    { ...playerView, myRole: { ...seer, description: "x".repeat(601) } },
    { ...playerView, myMessage: "x".repeat(281), canWriteMessage: true },
    {
      ...masterView,
      roles: Array.from({ length: 21 }, (_, index) => ({
        id: index + 1,
        ...jester,
        count: 61,
      })),
    },
    { ...masterView, gameMaster: null, messages: [] },
  ])
    assert.equal(werewolfSchema.safeParse(valid).success, true);
});

test("a game refuses unknown states, foreign portraits and broken invariants", () => {
  for (const invalid of [
    { ...playerView, status: "draft" },
    { ...playerView, phase: "dusk" },
    { ...playerView, revision: -1 },
    { ...playerView, joined: undefined },
    { ...playerView, players: [player(sam), player(sam)] },
    {
      ...playerView,
      players: [player({ ...sam, avatarUrl: "https://example.com/a.png" })],
    },
    { ...playerView, gameMaster: { ...alex, avatarUrl: "//evil.test/a" } },
    // A role is a known built-in, or a custom one with a name.
    { ...playerView, myRole: { ...seer, key: "vampire" } },
    { ...playerView, myRole: { key: null, name: null, description: null } },
    { ...playerView, myRole: { key: null, name: "", description: "" } },
    { ...playerView, mayorMessage: { from: robin, text: "" } },
    // The game master's view always carries the roles and the messages.
    { ...masterView, roles: null },
    { ...masterView, messages: null },
    { ...masterView, roles: [roles[0], roles[0]] },
    { ...masterView, roles: [{ ...roles[0], count: -1 }] },
    { ...masterView, messages: [{ from: robin, text: "Hou" }] },
  ])
    assert.equal(werewolfSchema.safeParse(invalid).success, false);
});

test("programme events carry a werewolf summary only for werewolf events", () => {
  assert.deepEqual(eventSchema.parse(event), event);
  const locked = { ...event, locked: true, werewolf: null };
  assert.deepEqual(eventSchema.parse(locked), locked);
  // The host still reads the summary of a locked game.
  assert.equal(eventSchema.safeParse({ ...event, locked: true }).success, true);
  for (const invalid of [
    { ...event, werewolf: null },
    { ...event, werewolf: undefined },
    { ...event, type: "event" },
    { ...event, type: "questions" },
    { ...event, werewolf: { ...event.werewolf, status: "open" } },
    { ...event, werewolf: { ...event.werewolf, players: -1 } },
  ])
    assert.equal(eventSchema.safeParse(invalid).success, false);
  assert.equal(
    werewolfSummarySchema.safeParse({
      status: "finished",
      gameMaster: null,
      players: 61,
    }).success,
    true,
  );
});

test("a built-in role is translated until its explanation is rewritten; authored text shows as written", () => {
  assert.deepEqual(roleText(seer, french), {
    name: "Voyante",
    description:
      "Chaque nuit, tu découvres le rôle d’un joueur de ton choix. À toi de t’en servir sans te faire repérer.",
  });
  assert.equal(roleText(seer, english).name, "Seer");
  // The rewritten explanation is the game master's: the name stays translated.
  assert.deepEqual(
    roleText({ ...seer, description: "Tu vois tout." }, english),
    {
      name: "Seer",
      description: "Tu vois tout.",
    },
  );
  assert.equal(roleText({ ...seer, description: "" }, french).description, "");
  // A stray name on a built-in role never replaces the translation.
  assert.equal(roleText({ ...seer, name: "Oracle" }, french).name, "Voyante");
  assert.deepEqual(roleText(jester, english), {
    name: "Bouffon",
    description: "Fais-toi éliminer.",
  });
  assert.deepEqual(
    roleText({ key: null, name: "Bouffon", description: null }, french),
    { name: "Bouffon", description: "" },
  );
});

test("every language names and explains the seven built-in roles", () => {
  for (const locale of locales) {
    const t = createTranslator(getMessages(locale));
    for (const key of [
      "werewolf",
      "villager",
      "seer",
      "witch",
      "hunter",
      "cupid",
      "guard",
    ] as const) {
      const { name, description } = roleText(
        { key, name: null, description: null },
        t,
      );
      assert.ok(name.trim() && description.trim(), `${locale}: ${key}`);
      assert.notEqual(name, t("common.actionFailed"), `${locale}: ${key}`);
    }
  }
});

test("the count line appears only while roles and players differ, in the singular and the plural", () => {
  assert.equal(countLine(11, 11, "fr", french), null);
  assert.equal(countLine(9, 11, "fr", french), "9 rôles pour 11 joueurs");
  assert.equal(countLine(1, 3, "fr", french), "1 rôle pour 3 joueurs");
  assert.equal(countLine(2, 1, "fr", french), "2 rôles pour 1 joueur");
  // French counts zero in the singular; English does not.
  assert.equal(countLine(0, 2, "fr", french), "0 rôle pour 2 joueurs");
  assert.equal(countLine(0, 1, "en", english), "0 roles for 1 player");
  assert.equal(countLine(12, 9, "en", english), "12 roles for 9 players");
  assert.equal(playerCount(1, "fr", french), "1 joueur");
  assert.equal(playerCount(5, "fr", french), "5 joueurs");
  for (const locale of locales) {
    const t = createTranslator(getMessages(locale));
    for (const count of [0, 1, 2, 60])
      assert.match(playerCount(count, locale, t), new RegExp(`^${count} \\S`));
  }
});

test("a game starts with at least three players and as many roles", () => {
  assert.equal(roleTotal(roles), 3);
  assert.equal(roleTotal([]), 0);
  assert.equal(startObstacle(3, 3), null);
  assert.equal(startObstacle(2, 2), "players");
  assert.equal(startObstacle(0, 0), "players");
  assert.equal(startObstacle(3, 5), "roles");
  assert.equal(startObstacle(6, 5), "roles");
});

test("completing with villagers fills the gap and nothing else", () => {
  const completed = completeWithVillagers(roles, 7);
  assert.deepEqual(
    completed.map((role) => role.count),
    [1, 4, 1, 1],
  );
  assert.equal(roleTotal(completed), 7);
  // The other roles are the same objects; the list itself is new.
  assert.equal(completed[0], roles[0]);
  assert.notEqual(completed, roles);
  assert.deepEqual(completeWithVillagers(roles, 3), roles);
  // Too many roles are the game master's to remove.
  assert.deepEqual(completeWithVillagers(roles, 2), roles);
});

test("players are listed alive first, then dead, each in join order", () => {
  const list = [
    player(alex, { alive: false }),
    player(sam),
    player(robin, { alive: false }),
    player({ id: 4, name: "Noa", avatarUrl: null }),
  ];
  const { alive, dead } = playersByFate(list);
  assert.deepEqual(
    alive.map((item) => item.name),
    ["Sam", "Noa"],
  );
  assert.deepEqual(
    dead.map((item) => item.name),
    ["Alex", "Robin"],
  );
  assert.deepEqual(playersByFate([]), { alive: [], dead: [] });
});

test("role rows become a request that keeps identities and returns default text to the translation", () => {
  const rows = roleDrafts(roles);
  assert.deepEqual(
    rows.map((row) => row.rowKey),
    ["saved-1", "saved-2", "saved-3", "saved-4"],
  );
  // A custom role's missing explanation is an empty field, not a null.
  assert.equal(
    roleDrafts([{ ...roles[3], description: null }])[0].description,
    "",
  );
  assert.deepEqual(roleInputs(rows, french), [
    { id: 1, key: "werewolf", name: null, description: null, count: 1 },
    { id: 2, key: "villager", name: null, description: null, count: 0 },
    { id: 3, key: "seer", name: null, description: "Tu vois tout.", count: 1 },
    {
      id: 4,
      key: null,
      name: "Bouffon",
      description: "Fais-toi éliminer.",
      count: 1,
    },
  ]);
  const edited: RoleDraft[] = [
    // Typed back to the translated text, or emptied: the translation again.
    { ...rows[0], description: `  ${french("werewolf.roleText.werewolf")} ` },
    { ...rows[2], description: "  " },
    {
      rowKey: "new-1",
      id: null,
      key: null,
      name: "  Ange ",
      description: " ",
      count: 2,
    },
  ];
  assert.deepEqual(roleInputs(edited, french), [
    { id: 1, key: "werewolf", name: null, description: null, count: 1 },
    { id: 3, key: "seer", name: null, description: null, count: 1 },
    { key: null, name: "Ange", description: "", count: 2 },
  ]);
  // The same text is an authored explanation in another language.
  assert.equal(
    roleInputs([edited[0]], english)[0].description,
    french("werewolf.roleText.werewolf"),
  );
  assert.equal(
    sameRoleInputs(
      roleInputs(rows, french),
      roleInputs(roleDrafts(roles), french),
    ),
    true,
  );
  assert.equal(
    sameRoleInputs(roleInputs(rows, french), roleInputs(edited, french)),
    false,
  );
});

test("a role without a name holds the list back", () => {
  const rows = roleDrafts(roles);
  assert.equal(unnamedRole(rows), undefined);
  const blank: RoleDraft = {
    rowKey: "new-1",
    id: null,
    key: null,
    name: "  ",
    description: "",
    count: 1,
  };
  assert.equal(unnamedRole([...rows, blank]), blank);
  // Built-in roles never need one.
  assert.equal(unnamedRole([{ ...rows[0], name: "" }]), undefined);
});

test("a completed role save keeps the rows and what was typed during the request", () => {
  const rows = roleDrafts(roles);
  const added: RoleDraft = {
    rowKey: "new-1",
    id: null,
    key: null,
    name: "Ange ",
    description: "",
    count: 1,
  };
  const submitted = [...rows, added];
  const saved: WerewolfRole[] = [
    ...roles,
    { id: 9, key: null, name: "Ange", description: "", count: 1 },
  ];
  // Nothing changed meanwhile: every row takes what the server stored.
  const settled = mergeSavedRoles(submitted, submitted, saved);
  assert.deepEqual(settled[4], {
    ...added,
    id: 9,
    name: "Ange",
  });
  assert.deepEqual(settled.slice(0, 4), rows);

  // A quantity pressed and a role added during the request stay for the next save.
  const later: RoleDraft = { ...added, rowKey: "new-2", name: "Idiot" };
  const current = [
    { ...rows[0], count: 3 },
    ...rows.slice(1),
    { ...added, description: "Protège le village." },
    later,
  ];
  const merged = mergeSavedRoles(current, submitted, saved);
  assert.equal(merged[0].count, 3);
  assert.deepEqual(merged[4], {
    ...added,
    id: 9,
    description: "Protège le village.",
  });
  assert.equal(merged[5], later);

  // A row deleted during the request stays deleted.
  assert.deepEqual(
    mergeSavedRoles(rows.slice(0, 2), submitted, saved).map((row) => row.id),
    [1, 2],
  );
  // The saved role is found again under the row that created it.
  assert.equal(roleDrafts(saved, new Map([[9, "new-1"]]))[4].rowKey, "new-1");
});

test("lengths count code points once trimmed, as Go does", () => {
  assert.equal(codePoints("  loup  "), 4);
  assert.equal(codePoints("🐺🐺"), 2);
  assert.equal(codePoints("   "), 0);
});

test("a werewolf event's draft holds its game master and submits it with the event", () => {
  const fresh = newEventDraft("werewolf", "Loup-garou");
  assert.deepEqual(fresh.werewolf, { gameMasterId: null });
  assert.equal(fresh.vote, null);
  assert.equal(newEventDraft("event").werewolf, null);
  assert.deepEqual(eventRequestBody(fresh, undefined, []).werewolf, {
    gameMasterId: null,
  });
  // The other event types send no werewolf settings at all.
  assert.equal(
    "werewolf" in eventRequestBody(newEventDraft("event"), undefined, []),
    false,
  );

  const draft = eventDraft(event);
  assert.deepEqual(draft.werewolf, { gameMasterId: 1 });
  assert.deepEqual(
    eventDraft({ ...event, locked: true, werewolf: null }).werewolf,
    {
      gameMasterId: null,
    },
  );
  const changed = { ...draft, werewolf: { gameMasterId: 2 } };
  assert.equal(sameDraft(draft, changed), false);
  const body = eventRequestBody(changed, event, []);
  assert.equal(body.type, "werewolf");
  assert.equal(body.revision, 2);
  assert.equal(body.vote, null);
  assert.deepEqual(body.werewolf, { gameMasterId: 2 });
});

test("a running game keeps its game master, whatever the draft says", () => {
  const running: PartyEvent = {
    ...event,
    werewolf: { status: "running", gameMaster: alex, players: 5 },
  };
  assert.equal(lockedGameMaster(running), true);
  assert.equal(lockedGameMaster(event), false);
  assert.equal(lockedGameMaster(undefined), false);
  assert.equal(
    lockedGameMaster({ ...event, type: "event", werewolf: null }),
    false,
  );
  const draft = { ...eventDraft(running), werewolf: { gameMasterId: 2 } };
  assert.deepEqual(eventRequestBody(draft, running, []).werewolf, {
    gameMasterId: 1,
  });
});

test("a completed event save keeps a game master picked during the request", () => {
  const submitted = eventDraft(event);
  const saved = eventDraft({
    ...event,
    revision: 3,
    werewolf: { status: "lobby", gameMaster: sam, players: 4 },
  });
  assert.deepEqual(mergeSavedDraft(submitted, submitted, saved).werewolf, {
    gameMasterId: 2,
  });
  const current = { ...submitted, werewolf: { gameMasterId: 3 } };
  const merged = mergeSavedDraft(current, submitted, saved);
  assert.deepEqual(merged.werewolf, { gameMasterId: 3 });
  assert.equal(merged.revision, 3);
});

test("a game master's commands never make the host's draft a conflict", () => {
  const draft = eventDraft(event);
  assert.equal(editedElsewhere(draft, event), false);
  assert.equal(editedElsewhere(draft, undefined), false);
  // The revision of a werewolf event moves with its game.
  assert.equal(editedElsewhere(draft, { ...event, revision: 9 }), false);
  const other: PartyEvent = { ...event, type: "event", werewolf: null };
  assert.equal(editedElsewhere(eventDraft(other), other), false);
  assert.equal(
    editedElsewhere(eventDraft(other), { ...other, revision: 3 }),
    true,
  );
});

test("the viewer's own role stays off the board until everyone may see it", () => {
  const running = { status: "running", hideRolesOfDead: false } as const;
  const own = player(sam, { role: seer });
  // Alive: the role waits behind the "see my role" control.
  assert.equal(boardRole(running, own, sam.id), null);
  // The game master and the other viewers read what the server sent.
  assert.equal(boardRole(running, own, alex.id), seer);
  assert.equal(boardRole(running, player(robin), sam.id), null);
  // Dead: public, unless deaths are secret.
  const dead = { ...own, alive: false };
  assert.equal(boardRole(running, dead, sam.id), seer);
  assert.equal(
    boardRole({ ...running, hideRolesOfDead: true }, dead, sam.id),
    null,
  );
  assert.equal(
    boardRole({ status: "finished", hideRolesOfDead: true }, own, sam.id),
    seer,
  );
});
