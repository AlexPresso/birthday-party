import { getParty, getSession } from "@/lib/server-api";
import { getBirthdayConfig } from "@/lib/birthday-config";
import { Navigation } from "@/components/navigation";
import { Sparkles } from "lucide-react";
import { getI18n } from "@/lib/server-i18n";

export const dynamic = "force-dynamic";

export default async function PartyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ guest }, party, { age, title }, { locale, t }] = await Promise.all([
    getSession(),
    getParty(),
    getBirthdayConfig(),
    getI18n(),
  ]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        {t("shell.skip")}
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {age}
            <span>✦</span>
          </span>
          <div>
            <strong>{party.title || title || t("birthday.fallback")}</strong>
          </div>
        </div>
        <div className="guest-chip">
          <span className="avatar">
            {guest.name.charAt(0).toLocaleUpperCase(locale)}
          </span>
          <span>{guest.name}</span>
          <Sparkles size={15} aria-hidden="true" />
        </div>
      </header>
      <main id="content" className="main-content">
        {children}
      </main>
      <Navigation />
    </div>
  );
}
