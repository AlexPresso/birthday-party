"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";

export function Avatar({
  name,
  avatarUrl,
  className = "",
}: {
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  const { locale } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {avatarUrl && avatarUrl !== failedUrl ? (
        // The API already resizes avatars; native images retain session cookies.
        <img
          src={avatarUrl}
          alt=""
          width={54}
          height={54}
          decoding="async"
          loading="lazy"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        name.charAt(0).toLocaleUpperCase(locale)
      )}
    </span>
  );
}
