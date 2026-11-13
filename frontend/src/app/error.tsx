"use client";
import { useI18n } from "@/lib/i18n-context";
export default function ErrorPage({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="invitation-page">
      <div className="invitation-card">
        <h1>{t("error.title")}</h1>
        <p className="muted">{t("error.description")}</p>
        <button className="button primary" onClick={retry}>
          {t("common.retry")}
        </button>
      </div>
    </main>
  );
}
