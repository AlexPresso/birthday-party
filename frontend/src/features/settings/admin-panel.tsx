"use client";
import { useRef, useState } from "react";
import {
  Users,
  CalendarDays,
  Image as ImageIcon,
  Cake,
  Mail,
  DoorOpen,
  Upload,
  ChevronRight,
} from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { api } from "@/lib/api";
import {
  configurationSchema,
  type Configuration,
  type Party,
} from "../party/contracts";
import type { Guest } from "../guests/contracts";
import type { PartyEvent } from "../programme/contracts";
import { PartyEditor } from "../party/party-editor";
import { GuestManager } from "../guests/guest-manager";
import { EventManager } from "../programme/event-manager";
import { ConfigurationEditor } from "../party/configuration-editor";
import { WelcomeAdmin } from "../welcome/welcome-admin";
import { MediaCategoriesAdmin } from "../media/media-categories-admin";
import type { AdminWelcome } from "../welcome/contracts";
import type { MediaCategory } from "../media/contracts";
import {
  SettingsNavigation,
  type SettingsSection,
} from "./settings-navigation";
import "./settings.css";

const groups = [
  {
    title: "configuration.party",
    items: [
      {
        section: "party",
        title: "configuration.partyDetails",
        description: "settings.partyDescription",
        Icon: Cake,
      },
      {
        section: "programme",
        title: "nav.programme",
        description: "settings.programmeDescription",
        Icon: CalendarDays,
      },
      {
        section: "welcome",
        title: "adminWelcome.title",
        description: "settings.welcomeDescription",
        Icon: DoorOpen,
      },
    ],
  },
  {
    title: "settings.guestsGroup",
    items: [
      {
        section: "guests",
        title: "configuration.guests",
        description: "settings.guestsDescription",
        Icon: Users,
      },
      {
        section: "invitation",
        title: "configuration.invitation",
        description: "configuration.textLanguages",
        Icon: Mail,
      },
    ],
  },
  {
    title: "configuration.photosAndVideos",
    items: [
      {
        section: "categories",
        title: "settings.categories",
        description: "settings.categoriesDescription",
        Icon: ImageIcon,
      },
      {
        section: "uploads",
        title: "settings.uploads",
        description: "settings.uploadsDescription",
        Icon: Upload,
      },
    ],
  },
] as const;

export function AdminPanel({
  guest,
  party: initialParty,
  guests: initialGuests,
  events,
  configuration: initialConfiguration,
  welcome,
  categories: initialCategories,
}: {
  guest: Guest;
  party: Party;
  guests: Guest[];
  events: PartyEvent[];
  configuration: Configuration;
  welcome: AdminWelcome;
  categories: MediaCategory[];
}) {
  const { t, locale } = useI18n();
  const [party, setParty] = useState(initialParty);
  const [guests, setGuests] = useState(initialGuests);
  const [categories, setCategories] = useState(initialCategories);
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const savedConfiguration = useRef(initialConfiguration);
  const configurationQueue = useRef<Promise<void>>(Promise.resolve());

  function saveConfiguration(patch: Partial<Configuration>) {
    // The API replaces the whole configuration. Merge each section's fields only
    // when its turn starts, including changes saved by another settings page.
    const save = configurationQueue.current.then(async () => {
      const updated = await api("/admin/config", configurationSchema, {
        method: "PUT",
        body: { ...savedConfiguration.current, ...patch },
      });
      savedConfiguration.current = updated;
      setConfiguration(updated);
    });
    configurationQueue.current = save.catch(() => {});
    return save;
  }

  function summary(section: SettingsSection) {
    const number = new Intl.NumberFormat(locale);
    switch (section) {
      case "party":
        return t(
          configuration.age === 1
            ? "configuration.ageOne"
            : "configuration.ageOther",
          { age: number.format(configuration.age) },
        );
      case "invitation":
        return t("configuration.textLanguages");
      case "uploads":
        return [configuration.imageSizeMB, configuration.videoSizeMB]
          .map((size) =>
            t("configuration.sizeValue", { size: number.format(size) }),
          )
          .join(" / ");
      default:
        return null;
    }
  }

  function updateGuest(guest: Guest) {
    setGuests((current) =>
      current.some((item) => item.id === guest.id)
        ? current.map((item) => (item.id === guest.id ? guest : item))
        : [...current, guest],
    );
  }
  function content(section: SettingsSection) {
    switch (section) {
      case "party":
        return (
          <div className="party-details-editor">
            <ConfigurationEditor
              initial={configuration}
              section="age"
              onSave={saveConfiguration}
            />
            <PartyEditor party={party} onSave={setParty} />
          </div>
        );
      case "invitation":
      case "uploads":
        return (
          <ConfigurationEditor
            initial={configuration}
            section={section}
            onSave={saveConfiguration}
          />
        );
      case "guests":
        return (
          <GuestManager
            guests={guests}
            onGuestChange={updateGuest}
            currentGuest={guest}
            timezone={party.timezone}
          />
        );
      case "programme":
        return (
          <EventManager
            initial={events}
            timezone={party.timezone}
            guests={guests}
          />
        );
      case "welcome":
        return <WelcomeAdmin initial={welcome} categories={categories} />;
      case "categories":
        return (
          <MediaCategoriesAdmin
            categories={categories}
            onSaved={(category) =>
              setCategories((current) =>
                current.some((item) => item.id === category.id)
                  ? current.map((item) =>
                      item.id === category.id ? category : item,
                    )
                  : [...current, category],
              )
            }
          />
        );
    }
  }
  return (
    <SettingsNavigation
      pages={groups.flatMap((group) =>
        group.items.map((item) => ({
          id: item.section,
          title: t(item.title),
          content: content(item.section),
        })),
      )}
    >
      {(navigate, selected) =>
        groups.map((group) => (
          <section
            className="settings-section"
            aria-labelledby={`settings-${group.title}`}
            key={group.title}
          >
            <h2 id={`settings-${group.title}`}>{t(group.title)}</h2>
            <div className="settings-menu-group">
              {group.items.map(({ section, title, description, Icon }) => (
                <a
                  className="settings-menu-link"
                  href={`/parametres?section=${section}`}
                  key={section}
                  aria-current={selected === section ? "page" : undefined}
                  onClick={(event) => navigate(event, section)}
                >
                  <Icon size={26} aria-hidden="true" />
                  <span className="settings-menu-label">
                    <span>{t(title)}</span>
                    {section !== "invitation" && (
                      <small className="visually-hidden">
                        {t(description)}
                      </small>
                    )}
                  </span>
                  <span className="settings-menu-value">
                    {summary(section)}
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        ))
      }
    </SettingsNavigation>
  );
}
