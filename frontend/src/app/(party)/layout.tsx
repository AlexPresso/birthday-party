import { getParty } from "@/features/party/server";
import { getSession } from "@/features/guests/server";
import { getBirthdayConfig } from "@/features/party/birthday-config";
import { Navigation } from "@/components/navigation";
import { getI18n } from "@/lib/server-i18n";
import { UploadProvider, UploadNotice } from "@/features/media/upload-provider";
import { GuestAccessMonitor } from "@/features/welcome/guest-access-monitor";
import { Avatar } from "@/components/avatar";

export const dynamic = "force-dynamic";

export default async function PartyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ guest }, party, { age, title }, { t }] = await Promise.all([
    getSession(),
    getParty(),
    getBirthdayConfig(),
    getI18n(),
  ]);
  return (
    <div className="app-shell">
      {guest.role === "guest" && <GuestAccessMonitor />}
      <a className="skip-link" href="#content">
        {t("shell.skip")}
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {age}
          </span>
          <div>
            <strong>{party.title || title || t("birthday.fallback")}</strong>
          </div>
        </div>
        <div className="guest-chip">
          <Avatar name={guest.name} avatarUrl={guest.avatarUrl} />
          <span>{guest.name}</span>
        </div>
      </header>
      <UploadProvider>
        <main id="content" className="main-content">
          <UploadNotice />
          {children}
        </main>
        <Navigation />
      </UploadProvider>
    </div>
  );
}
