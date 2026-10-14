import "server-only";
import { connection } from "next/server";
import { getI18n } from "./server-i18n";
import { birthdayCopy } from "./birthday-copy";

export async function getBirthdayConfig() {
  // Read at request time so the same Docker image accepts new environment values.
  await connection();
  const { locale, t } = await getI18n();
  return birthdayCopy(process.env, locale, t);
}
