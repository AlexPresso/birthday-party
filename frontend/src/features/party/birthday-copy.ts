import type { Locale } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";
import type { PublicConfiguration } from "./contracts";

export function birthdayCopy(
  configuration: PublicConfiguration,
  locale: Locale,
  t: Translator,
) {
  const { age, invitation } = configuration;
  const localized = invitation.locales[locale];
  return {
    age,
    title:
      localized.title?.trim() ??
      invitation.title?.trim() ??
      t(age === 1 ? "birthday.titleOne" : "birthday.title", { age }),
    description:
      localized.description?.trim() ??
      invitation.description?.trim() ??
      t("birthday.description"),
  };
}
