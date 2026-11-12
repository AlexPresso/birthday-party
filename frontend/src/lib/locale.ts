export const locales = ["en", "fr", "de", "it", "es"] as const;
export type Locale = (typeof locales)[number];
const defaultLocale: Locale = "en";

export function detectLocale(acceptLanguage: string | null): Locale {
  const preferences = (acceptLanguage ?? "")
    .split(",")
    .slice(0, 30)
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((value) => value.trim().startsWith("q="));
      const weight = quality ? Number(quality.trim().slice(2)) : 1;
      return { tag, weight };
    })
    .filter(
      ({ tag, weight }) =>
        /^(?:[a-z]{2,8}(?:-[a-z0-9]{1,8})*|\*)$/.test(tag) &&
        Number.isFinite(weight) &&
        weight > 0 &&
        weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of preferences) {
    if (tag === "*") return defaultLocale;
    const language = tag.split("-")[0];
    const supported = locales.find((locale) => locale === language);
    if (supported) return supported;
  }
  return defaultLocale;
}
