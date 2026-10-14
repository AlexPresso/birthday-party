import type { Locale } from "./locale";
import type { Translator } from "./i18n";

export function birthdayCopy(
  environment: Record<string, string | undefined>,
  locale: Locale,
  t: Translator,
) {
  const configuredAge = Number(environment.BIRTHDAY_AGE);
  const age =
    Number.isInteger(configuredAge) &&
    configuredAge >= 1 &&
    configuredAge <= 150
      ? configuredAge
      : 30;
  const custom = (name: string) =>
    environment[`${name}_${locale.toUpperCase()}`]?.trim() ??
    environment[name]?.trim();
  return {
    age,
    title:
      custom("INVITATION_TITLE") ??
      t(age === 1 ? "birthday.titleOne" : "birthday.title", { age }),
    description: custom("INVITATION_DESCRIPTION") ?? t("birthday.description"),
  };
}
