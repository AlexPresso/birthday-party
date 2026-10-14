import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { detectLocale } from "./locale";
import { getMessages } from "./dictionaries";
import { createTranslator } from "./i18n";

export const getI18n = cache(async () => {
  const locale = detectLocale((await headers()).get("accept-language"));
  const messages = getMessages(locale);
  return { locale, messages, t: createTranslator(messages) };
});
