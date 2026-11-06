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
  return (
    <nav className="navigation" aria-label={t("nav.label")}>
      {visibleTabs.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          aria-label={t(label)}
          title={t(label)}
          aria-current={
            pathname === href || pathname.startsWith(`${href}/`)
              ? "page"
              : undefined
          }
        >
          <Icon size={30} strokeWidth={1.7} aria-hidden="true" />
          <NavigationPending />
        </Link>
      ))}
      <Link
        className="navigation-profile"
        href="/profil"
        aria-label={`${t("nav.profile")}: ${guestName}`}
        title={t("nav.profile")}
        aria-current={pathname === "/profil" ? "page" : undefined}
      >
        <Avatar name={guestName} avatarUrl={avatarUrl} />
        <NavigationPending />
      </Link>
    </nav>
  );
}
