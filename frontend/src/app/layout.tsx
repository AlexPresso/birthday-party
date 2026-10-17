import type { Metadata, Viewport } from "next";
import { getBirthdayConfig } from "@/lib/birthday-config";
import { getI18n } from "@/lib/server-i18n";
import { I18nProvider } from "@/lib/i18n-context";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { title, description } = await getBirthdayConfig();
  const { t } = await getI18n();
  return {
    title: title
      ? { default: title, template: `%s · ${title}` }
      : t("birthday.fallback"),
    description: description || undefined,
    applicationName: title || t("birthday.fallback"),
    appleWebApp: {
      capable: true,
      title: title || t("birthday.fallback"),
      statusBarStyle: "black",
    },
    icons: {
      icon: "/icons/app.svg",
      apple: "/icons/apple-touch-icon.png",
    },
    robots: { index: false, follow: false },
  };
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#151218",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, messages } = await getI18n();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
