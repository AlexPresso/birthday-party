import "server-only";
import { cache } from "react";
import { getI18n } from "@/lib/server-i18n";
import { serverApi } from "@/lib/server-api";
import { publicConfigurationSchema } from "./contracts";
import { birthdayCopy } from "./birthday-copy";

const getPublicConfiguration = cache(() =>
  serverApi("/config", publicConfigurationSchema),
);

export const getBirthdayConfig = cache(async () => {
  const [configuration, { locale, t }] = await Promise.all([
    getPublicConfiguration(),
    getI18n(),
  ]);
  return birthdayCopy(configuration, locale, t);
});

/** The host's theme and main colour, public like the invitation text. */
export async function getAppearance() {
  return (await getPublicConfiguration()).appearance;
}
