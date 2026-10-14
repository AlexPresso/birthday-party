"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Messages, type Translator } from "./i18n";
import type { Locale } from "./locale";

const I18nContext = createContext<{ locale: Locale; t: Translator } | null>(
  null,
);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(messages) }),
    [locale, messages],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is required.");
  return context;
}
