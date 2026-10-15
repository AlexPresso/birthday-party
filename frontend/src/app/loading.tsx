"use client";
import { useI18n } from "@/lib/i18n-context";
export default function Loading() {
  const { t } = useI18n();
  return (
    <div className="page-loading" role="status">
      <span className="spinner" />
      {t("common.loading")}
    </div>
  );
}
