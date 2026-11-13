import { getParty } from "@/features/party/server";
import { getSession } from "@/features/guests/server";
import { getBirthdayConfig } from "@/features/party/birthday-config";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Navigation } from "@/components/navigation";
import { Snow } from "@/components/snow";
import { getI18n } from "@/lib/server-i18n";
import { UploadProvider } from "@/features/media/upload-provider";
import { UploadQueue } from "@/features/media/upload-queue";
import { GuestAccessMonitor } from "@/features/welcome/guest-access-monitor";

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
      {guest.role === "guest" && <GuestAccessMonitor />}
      <a className="skip-link" href="#content">
        {t("shell.skip")}
      </a>
      <Snow count={26} />
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <div>
            <strong>
              {party.title ||
                title ||
                t(age === 1 ? "birthday.titleOne" : "birthday.title", {
                  age: new Intl.NumberFormat(locale).format(age),
                })}
            </strong>
          </div>
        </div>
      </header>
      <UploadProvider>
        <ConfirmProvider>
          <main id="content" className="main-content">
            {children}
          </main>
        </ConfirmProvider>
        <UploadQueue />
        <Navigation
          isAdmin={guest.role === "admin"}
          guestName={guest.name}
          avatarUrl={guest.avatarUrl}
        />
      </UploadProvider>
    </div>
  );
}
