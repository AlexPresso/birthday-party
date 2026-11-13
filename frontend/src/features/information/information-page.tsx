"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { PageHeading } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import type { InformationTab } from "./contracts";
import { linkify } from "./linkify";
import "./information.css";

/** The host's text as typed: line breaks kept, addresses and numbers linked. */
function InformationText({ body }: { body: string }) {
  const segments = useMemo(() => linkify(body), [body]);
  return (
    <p className="information-text">
      {segments.map((segment, index) =>
        segment.href === undefined ? (
          segment.text
        ) : segment.href.startsWith("http") ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {segment.text}
          </a>
        ) : (
          <a key={index} href={segment.href}>
            {segment.text}
          </a>
        ),
      )}
    </p>
  );
}

/** The guest page: one text, or a tab list when the host wrote several. */
export function InformationPage({ tabs }: { tabs: InformationTab[] }) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState(0);
  // A refresh can bring fewer tabs than the one that was open.
  const current = Math.min(selected, tabs.length - 1);
  const tab = tabs[current];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return (
    <>
      <PageHeading title={t("page.information")} />
      {!tab ? null : tabs.length === 1 ? (
        <section className="information-panel" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{tab.title}</h2>
          <InformationText body={tab.body} />
        </section>
      ) : (
        <>
          <div
            className="information-tabs"
            role="tablist"
            aria-label={t("information.tabs")}
          >
            {tabs.map((item, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={index === current}
                aria-controls={`${id}-panel`}
                tabIndex={index === current ? 0 : -1}
                onClick={() => setSelected(index)}
                onKeyDown={onKeyDown}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div
            className="information-panel"
            role="tabpanel"
            id={`${id}-panel`}
            aria-labelledby={`${id}-tab-${current}`}
            tabIndex={0}
          >
            <InformationText body={tab.body} />
          </div>
        </>
      )}
    </>
  );
}
