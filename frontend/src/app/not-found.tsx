import Link from "next/link";
import { getI18n } from "@/lib/server-i18n";
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="invitation-page">
      <div className="invitation-card">
        <h1>{t("notFound.title")}</h1>
        <Link className="button primary" href="/photos">
          {t("notFound.return")}
        </Link>
      </div>
    </main>
  );
}
