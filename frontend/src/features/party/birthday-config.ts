import "server-only";
import { cache } from "react";
import { getI18n } from "@/lib/server-i18n";
import { serverApi } from "@/lib/server-api";
import { publicConfigurationSchema } from "./contracts";
import { birthdayCopy } from "./birthday-copy";

export const getBirthdayConfig = cache(async () => {
  const [configuration, { locale, t }] = await Promise.all([
    serverApi("/config", publicConfigurationSchema),
    getI18n(),
  ]);
  return birthdayCopy(configuration, locale, t);
});
