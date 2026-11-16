import test from "node:test";
import assert from "node:assert/strict";
import {
  invitationMessage,
  whatsappLink,
} from "../src/features/guests/invitation-message.ts";

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

test("WhatsApp opens on the device with the number's digits and the message", () => {
  const url = new URL(
    whatsappLink("+41791234567", "Salut {name} : {link}", "Léa", link),
  );
  assert.equal(url.protocol, "whatsapp:");
  assert.equal(url.searchParams.get("phone"), "41791234567");
  assert.equal(url.searchParams.get("text"), `Salut Léa : ${link}`);
});
