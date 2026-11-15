import test from "node:test";
import assert from "node:assert/strict";
import {
  configurationSchema,
  publicConfigurationSchema,
} from "../src/features/party/contracts.ts";

const configuration = {
  age: 30,
  imageSizeMB: 15,
  videoSizeMB: 100,
  invitation: {
    title: null,
    description: "",
    locales: {
      en: { title: null, description: null },
      fr: { title: "Un anniversaire", description: "" },
      de: { title: null, description: null },
      it: { title: null, description: null },
      es: { title: null, description: null },
    },
  },
  appearance: { theme: "light", accent: "#3e63dd" },
  whatsappMessage: "Coucou {name} : {link}",
};

test("configuration responses preserve defaults, hidden text and authored translations", () => {
  assert.deepEqual(configurationSchema.parse(configuration), configuration);
  const publicConfiguration = publicConfigurationSchema.parse(configuration);
  assert.deepEqual(publicConfiguration.invitation, configuration.invitation);
  assert.deepEqual(publicConfiguration.appearance, configuration.appearance);
  assert.equal("imageSizeMB" in publicConfiguration, false);
  assert.equal("videoSizeMB" in publicConfiguration, false);
  assert.equal("whatsappMessage" in publicConfiguration, false);
  assert.equal(
    configurationSchema.safeParse(publicConfiguration).success,
    false,
  );
  assert.equal(
    publicConfigurationSchema.safeParse({
      ...configuration,
      invitation: { ...configuration.invitation, locales: {} },
    }).success,
    false,
  );
});

test("configuration responses reject unsupported ages and upload limits", () => {
  for (const age of [0, 151, 30.5, "30", null]) {
    assert.equal(
      configurationSchema.safeParse({ ...configuration, age }).success,
      false,
    );
  }
  for (const field of ["imageSizeMB", "videoSizeMB"]) {
    for (const value of [0, 1025, 1.5, "15", null]) {
      assert.equal(
        configurationSchema.safeParse({ ...configuration, [field]: value })
          .success,
        false,
      );
    }
    for (const value of [1, 1024]) {
      assert.equal(
        configurationSchema.safeParse({ ...configuration, [field]: value })
          .success,
        true,
      );
    }
  }
});

test("configuration responses require a known theme and a six-digit colour", () => {
  for (const appearance of [
    undefined,
    { theme: "dark" },
    { accent: "#ff6a1f" },
    { theme: "sepia", accent: "#ff6a1f" },
    { theme: "dark", accent: "#fff" },
    { theme: "dark", accent: "ff6a1f" },
    { theme: "dark", accent: "#ff6a1g" },
  ]) {
    assert.equal(
      publicConfigurationSchema.safeParse({ ...configuration, appearance })
        .success,
      false,
      JSON.stringify(appearance),
    );
  }
  for (const accent of ["#ff6a1f", "#FFC53D"]) {
    assert.equal(
      configurationSchema.safeParse({
        ...configuration,
        appearance: { theme: "dark", accent },
      }).success,
      true,
    );
  }
});
