import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { accentProperties } from "@/features/party/appearance";
import {
  getAppearance,
  getBirthdayConfig,
} from "@/features/party/birthday-config";
import { getI18n } from "@/lib/server-i18n";
import { I18nProvider } from "@/lib/i18n-context";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [{ title, description }, { theme }, { t }] = await Promise.all([
    getBirthdayConfig(),
    getAppearance(),
    getI18n(),
  ]);
  return {
    title: title
      ? { default: title, template: `%s · ${title}` }
      : t("birthday.fallback"),
    description: description || undefined,
    applicationName: title || t("birthday.fallback"),
    appleWebApp: {
      capable: true,
      title: title || t("birthday.fallback"),
      // Light text over the page in the dark theme, dark text in the light one.
      statusBarStyle: theme === "light" ? "default" : "black-translucent",
    },
    icons: {
      icon: "/icons/app.svg",
      apple: "/icons/apple-touch-icon.png",
    },
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getAppearance();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    // The page background of the theme (tokens.css).
    themeColor: theme === "light" ? "#f7f3ee" : "#100f0e",
    colorScheme: theme,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ locale, messages }, { theme, accent }] = await Promise.all([
    getI18n(),
    getAppearance(),
  ]);
  // Rendered with the document, so the first paint already has the host's
  // theme and colour. The style-src policy allows style attributes.
  return (
    <html
      lang={locale}
      data-theme={theme}
      style={accentProperties(accent, theme) as CSSProperties}
    >
      <head>
        <link
          rel="preload"
          href="/fonts/figtree-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/unbounded-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
