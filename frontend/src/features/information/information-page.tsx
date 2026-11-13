"use client";

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PageHeading } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import type { InformationTab } from "./contracts";
import { linkify } from "./linkify";
import "./information.css";

/** The query parameter that names the open tab, counted from 1. */
const tabParameter = "onglet";

const desktopQuery = "(min-width: 960px)";
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function isDesktop() {
  return window.matchMedia(desktopQuery).matches;
}
function serverDesktop() {
  return false;
}

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

/** The guest page: one text, or a menu of titles when the host wrote several. */
export function InformationPage({ tabs }: { tabs: InformationTab[] }) {
  const { t } = useI18n();
  const id = useId();
  if (tabs.length > 1) return <InformationTabs tabs={tabs} />;
  const [tab] = tabs;
  return (
    <>
      <PageHeading title={t("page.information")} />
      {tab && (
        <section className="information-panel" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{tab.title}</h2>
          <InformationText body={tab.body} />
        </section>
      )}
    </>
  );
}

/**
 * Several tabs, laid out like the host's settings. Phones show a menu of
 * titles; a title opens its text as a page that slides in, with a back arrow.
 * From 960px the menu stays on the left and the text on the right. The open
 * tab lives in the URL, so the browser's back button works.
 */
function InformationTabs({ tabs }: { tabs: InformationTab[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const parameter = useSearchParams().get(tabParameter) ?? "";
  // Anything but the number of an existing tab shows the menu.
  const requested =
    /^[1-9]\d*$/.test(parameter) && Number(parameter) <= tabs.length
      ? Number(parameter) - 1
      : null;
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    isDesktop,
    serverDesktop,
  );
  // Beside the menu there is always a text: the first one by default.
  const selected = desktop && requested === null ? 0 : requested;
  const TabHeading = desktop ? "h2" : "h1";
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef({ selected, desktop });
  const href = (index: number) => `${pathname}?${tabParameter}=${index + 1}`;

  function open(event: MouseEvent<HTMLAnchorElement>, index: number) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (index === selected) {
      container.current
        ?.querySelector<HTMLElement>(
          `[data-information-screen="${index + 1}"] [data-information-title]`,
        )
        ?.focus();
      return;
    }
    window.history.replaceState(
      { ...window.history.state, informationScroll: window.scrollY },
      "",
    );
    window.history.pushState(
      { informationFromMenu: requested === null },
      "",
      href(index),
    );
  }

  function back() {
    if (window.history.state?.informationFromMenu) window.history.back();
    else window.history.replaceState(null, "", pathname);
  }

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = { selected, desktop };
    // Crossing the breakpoint rearranges the page; nothing was opened.
    if (from.selected === selected || from.desktop !== desktop) return;
    const screen = (tab: number | null) =>
      container.current?.querySelector<HTMLElement>(
        `[data-information-screen="${tab === null ? "menu" : tab + 1}"]`,
      );
    const incoming = screen(selected);
    const outgoing = screen(from.selected);
    if (!incoming || !outgoing) return;
    const returning = selected === null;
    const scrolledBefore = window.scrollY;
    const scrollTarget = returning
      ? (window.history.state?.informationScroll ?? 0)
      : 0;
    window.scrollTo({ top: scrollTarget, behavior: "instant" });
    // Back on the menu, focus returns to the title that was opened.
    incoming
      .querySelector<HTMLElement>(
        from.selected !== null && returning
          ? `a[data-information-tab="${from.selected + 1}"]`
          : "[data-information-title]",
      )
      ?.focus({ preventScroll: true });

    if (
      desktop ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // Keep the departing screen visible only for the push transition. It stays
    // inert and hidden from assistive technology while the new screen is active.
    outgoing.hidden = false;
    outgoing.dataset.leaving = "true";
    // The page has just scrolled; hold the departing screen where it was.
    outgoing.style.top = `${scrollTarget - scrolledBefore}px`;
    // The same motion as a settings section: the new screen crosses the whole
    // viewport while the old one drifts a third of the way and fades.
    const distance = window.innerWidth * (returning ? -1 : 1);
    const options = { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
    const entrance = incoming.animate(
      [
        { transform: `translateX(${distance}px)` },
        { transform: "translateX(0)" },
      ],
      options,
    );
    const departure = outgoing.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: `translateX(${distance * -0.3}px)`, opacity: 0 },
      ],
      options,
    );
    function finish() {
      outgoing!.hidden = outgoing!.inert;
      outgoing!.style.top = "";
      delete outgoing!.dataset.leaving;
    }
    departure.onfinish = finish;
    return () => {
      entrance.cancel();
      departure.cancel();
      finish();
    };
  }, [selected, desktop]);

  const menuActive = desktop || selected === null;
  return (
    <div className="information-page" ref={container}>
      <section
        className="information-screen"
        data-information-screen="menu"
        hidden={!menuActive}
        inert={!menuActive}
        aria-hidden={!menuActive || undefined}
      >
        <PageHeading title={t("page.information")} />
        <nav className="information-menu" aria-label={t("information.tabs")}>
          {tabs.map((tab, index) => (
            <a
              key={index}
              href={href(index)}
              data-information-tab={index + 1}
              aria-current={selected === index ? "page" : undefined}
              onClick={(event) => open(event, index)}
            >
              <span>{tab.title}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </section>
      {tabs.map((tab, index) => (
        <section
          key={index}
          className="information-screen"
          data-information-screen={index + 1}
          hidden={selected !== index}
          inert={selected !== index}
          aria-hidden={selected !== index || undefined}
        >
          {/* Outside the heading so it can stay pinned while the title scrolls away. */}
          <button
            type="button"
            className="icon-button information-back"
            onClick={back}
            aria-label={t("information.back")}
            title={t("information.back")}
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <header className="information-tab-heading">
            <TabHeading tabIndex={-1} data-information-title>
              {tab.title}
            </TabHeading>
          </header>
          <div className="information-panel">
            <InformationText body={tab.body} />
          </div>
        </section>
      ))}
    </div>
  );
}
