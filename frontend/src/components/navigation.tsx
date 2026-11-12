"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Image as ImageIcon,
  CalendarDays,
  BookOpen,
  Settings,
} from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { Avatar } from "./avatar";

const tabs = [
  { href: "/programme", label: "nav.programme", Icon: CalendarDays },
  { href: "/photos", label: "nav.photos", Icon: ImageIcon },
  { href: "/livre-d-or", label: "nav.guestbook", Icon: BookOpen },
  { href: "/parametres", label: "nav.settings", Icon: Settings },
] as const;

function NavigationPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      className="navigation-pending"
      data-pending={pending || undefined}
      aria-hidden="true"
    />
  );
}

export function Navigation({
  isAdmin,
  guestName,
  avatarUrl,
}: {
  isAdmin: boolean;
  guestName: string;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const visibleTabs = tabs.filter(
    ({ href }) => href !== "/parametres" || isAdmin,
  );
  const isCurrent = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  // The profile comes last, so it sits to the right of every tab.
  const currentIndex =
    pathname === "/profil"
      ? visibleTabs.length
      : visibleTabs.findIndex(({ href }) => isCurrent(href));
  // Pages slide the way the dock reads: towards the tab that was pressed.
  const direction = (index: number) =>
    currentIndex < 0 || index === currentIndex
      ? undefined
      : [index > currentIndex ? "nav-forward" : "nav-back"];
  return (
    <nav
      className="navigation"
      aria-label={t("nav.label")}
      data-tabs={visibleTabs.length + 1}
    >
      {visibleTabs.map(({ href, label, Icon }, index) => (
        <Link
          key={href}
          href={href}
          aria-label={t(label)}
          title={t(label)}
          aria-current={isCurrent(href) ? "page" : undefined}
          transitionTypes={direction(index)}
        >
          {/* One named pill, so it glides from the previous tab to this one. */}
          {isCurrent(href) && (
            <span className="navigation-indicator" aria-hidden="true" />
          )}
          <span
            className="navigation-content"
            style={{ viewTransitionName: `nav-tab-${index}` }}
          >
            <Icon size={24} strokeWidth={2} aria-hidden="true" />
            {/* Shown by CSS for the current tab only; the link keeps its aria-label. */}
            <span className="navigation-label" aria-hidden="true">
              {t(label)}
            </span>
          </span>
          <NavigationPending />
        </Link>
      ))}
      <Link
        className="navigation-profile"
        href="/profil"
        aria-label={`${t("nav.profile")}: ${guestName}`}
        title={t("nav.profile")}
        aria-current={pathname === "/profil" ? "page" : undefined}
        transitionTypes={direction(visibleTabs.length)}
      >
        <span
          className="navigation-content"
          style={{ viewTransitionName: "nav-tab-profile" }}
        >
          <Avatar name={guestName} avatarUrl={avatarUrl} />
        </span>
        <NavigationPending />
      </Link>
    </nav>
  );
}
