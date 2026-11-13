"use client";

import { useSyncExternalStore } from "react";
import { detectLocale, type Locale } from "@/lib/locale";
import { globalErrorMessages } from "@/lib/messages/global-error";
import "./globals.css";

function subscribeLanguage(notify: () => void) {
  window.addEventListener("languagechange", notify);
  return () => window.removeEventListener("languagechange", notify);
}

const browserLocale = () => detectLocale(navigator.languages.join(","));
const serverLocale = (): Locale => "en";

// Replaces the root layout when it fails, so it renders its own document and
// cannot rely on the i18n provider or the request's Accept-Language header.
export default function GlobalError({ retry }: { retry: () => void }) {
  const locale = useSyncExternalStore(
    subscribeLanguage,
    browserLocale,
    serverLocale,
  );
  const messages = globalErrorMessages[locale];
  return (
    <html lang={locale}>
      <body>
        <title>{messages["error.title"]}</title>
        <main className="invitation-page">
          <div className="invitation-card">
            <h1>{messages["error.title"]}</h1>
            <p className="muted">{messages["error.description"]}</p>
            <button className="button primary" type="button" onClick={retry}>
              {messages["common.retry"]}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
