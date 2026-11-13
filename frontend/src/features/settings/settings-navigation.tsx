"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import {
  AutosaveProvider,
  AutosaveScope,
  useAutosaveNavigation,
} from "@/lib/autosave";

export type SettingsSection =
  | "party"
  | "programme"
  | "guests"
  | "invitation"
  | "welcome"
  | "categories"
  | "uploads";
type SettingsPage = { id: SettingsSection; title: string; content: ReactNode };
type Navigate = (
  event: MouseEvent<HTMLAnchorElement>,
  section: SettingsSection,
) => void;
type SettingsMenu = (
  navigate: Navigate,
  selected: SettingsSection | "index",
) => ReactNode;

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

function SettingsScreen({
  active,
  id,
  children,
}: {
  active: boolean;
  id: string;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  // Retain drafts after the first visit without mounting every editor up front.
  if (active && !visited) setVisited(true);
  return (
    <section
      className="settings-screen"
      data-settings-screen={id}
      hidden={!active}
      inert={!active}
      aria-hidden={!active || undefined}
    >
      {visited ? (
        <AutosaveScope name={id} active={active}>
          {children}
        </AutosaveScope>
      ) : null}
    </section>
  );
}

export function SettingsNavigation({
  pages,
  children,
}: {
  pages: SettingsPage[];
  children: SettingsMenu;
}) {
  return (
    <AutosaveProvider>
      <SettingsPages pages={pages}>{children}</SettingsPages>
    </AutosaveProvider>
  );
}

function SettingsPages({
  pages,
  children,
}: {
  pages: SettingsPage[];
  children: SettingsMenu;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const requested = pages.find((page) => page.id === section)?.id ?? "index";
  const [active, setActive] = useState<SettingsSection | "index">(requested);
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    isDesktop,
    serverDesktop,
  );
  const selected = desktop && active === "index" ? "party" : active;
  const PanelHeading = desktop ? "h2" : "h1";
  const [leaving, setLeaving] = useState(false);
  const backPending = useRef(false);
  const flush = useAutosaveNavigation();
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(active);

  useEffect(() => {
    if (requested === active) return;
    let cancelled = false;
    void flush(selected).then((saved) => {
      if (cancelled) return;
      if (saved) setActive(requested);
      else {
        window.history.replaceState(
          window.history.state,
          "",
          selected === "index"
            ? "/parametres"
            : `/parametres?section=${selected}`,
        );
        setActive(selected);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requested, active, selected, flush]);

  async function navigate(
    event: MouseEvent<HTMLAnchorElement>,
    section: SettingsSection,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (leaving || requested !== active) return;
    if (section === selected) {
      event.currentTarget
        .closest(".settings-page")
        ?.querySelector<HTMLElement>(
          `[data-settings-screen="${selected}"] [data-settings-title]`,
        )
        ?.focus();
      return;
    }
    setLeaving(true);
    try {
      if (!(await flush(selected))) return;
      window.history.replaceState(
        { ...window.history.state, settingsScroll: window.scrollY },
        "",
      );
      window.history.pushState(
        { settingsFromIndex: active === "index" },
        "",
        `/parametres?section=${section}`,
      );
    } finally {
      setLeaving(false);
    }
  }
  async function back() {
    if (backPending.current) return;
    backPending.current = true;
    setLeaving(true);
    try {
      if (!(await flush(selected))) return;
      if (window.history.state?.settingsFromIndex) window.history.back();
      else window.history.replaceState(null, "", "/parametres");
    } finally {
      backPending.current = false;
      setLeaving(false);
    }
  }

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = selected;
    if (from === selected) return;
    const incoming = container.current?.querySelector<HTMLElement>(
      `[data-settings-screen="${selected}"]`,
    );
    const outgoing = container.current?.querySelector<HTMLElement>(
      `[data-settings-screen="${from}"]`,
    );
    if (!incoming || !outgoing) return;
    const returning = selected === "index";
    const scrolledBefore = window.scrollY;
    const scrollTarget = returning
      ? (window.history.state?.settingsScroll ?? 0)
      : 0;
    window.scrollTo({ top: scrollTarget, behavior: "instant" });
    const focus = returning
      ? incoming.querySelector<HTMLElement>(
          `a[href="/parametres?section=${from}"]`,
        )
      : incoming.querySelector<HTMLElement>("[data-settings-title]");
    focus?.focus({ preventScroll: true });

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
    // The new screen crosses the whole viewport while the old one drifts a
    // third of the way and fades, so the two never read as overlapping pages.
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

  return (
    <div
      className="settings-page"
      ref={container}
      aria-busy={leaving || requested !== active}
    >
      <SettingsScreen active={desktop || selected === "index"} id="index">
        <header className="settings-index-heading">
          <h1>{t("page.settings")}</h1>
        </header>
        <nav aria-label={t("page.settings")}>
          {children(navigate, selected)}
        </nav>
      </SettingsScreen>
      {pages.map((page) => (
        <SettingsScreen
          key={page.id}
          active={selected === page.id}
          id={page.id}
        >
          {/* Outside the heading so it can stay pinned while the title scrolls away. */}
          <button
            type="button"
            className="icon-button settings-back"
            onClick={back}
            disabled={leaving || requested !== active}
            aria-label={t("settings.back")}
            title={t("settings.back")}
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <header className="settings-subpage-heading">
            <PanelHeading tabIndex={-1} data-settings-title>
              {page.title}
            </PanelHeading>
          </header>
          <div className="settings-editor" id={`${page.id}-editor`}>
            {page.content}
          </div>
        </SettingsScreen>
      ))}
    </div>
  );
}
