import test from "node:test";
import assert from "node:assert/strict";
import { invitationMessage } from "../src/features/guests/invitation-message.ts";

const link = "https://party.example/invitation#token=abc";

test("the WhatsApp message fills in the guest's name and link", () => {
  assert.equal(
    invitationMessage("Salut {name} ! {link} À samedi, {name}.", "Léa", link),
    `Salut Léa ! ${link} À samedi, Léa.`,
  );
});

test("a template without the link still sends it, at the end", () => {
  assert.equal(
    invitationMessage("Salut {name} !", "Léa", link),
    `Salut Léa !\n${link}`,
  );
});
