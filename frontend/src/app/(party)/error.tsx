"use client";
import { WifiOff } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState icon={<WifiOff size={32} />} title={t("error.partyTitle")}>
      <p>{t("error.partyDescription")}</p>
      <button className="button primary" onClick={reset}>
        {t("common.retry")}
      </button>
    </EmptyState>
  );
}
