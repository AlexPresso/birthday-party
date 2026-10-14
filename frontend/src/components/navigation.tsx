"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Images, CalendarDays, BookOpen, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

const tabs = [
  { href: "/photos", label: "nav.photos", Icon: Images },
  { href: "/programme", label: "nav.programme", Icon: CalendarDays },
  { href: "/livre-d-or", label: "nav.guestbook", Icon: BookOpen },
  { href: "/parametres", label: "nav.settings", Icon: Settings },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="navigation" aria-label={t("nav.label")}>
      {tabs.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          aria-current={pathname === href ? "page" : undefined}
        >
          <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
          <span>{t(label)}</span>
        </Link>
      ))}
    </nav>
  );
}
