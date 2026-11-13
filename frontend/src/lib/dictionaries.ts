import { commonMessages } from "./messages/common.ts";
import { adminMessages } from "./messages/admin.ts";
import { mediaMessages } from "./messages/media.ts";
import { welcomeMessages } from "./messages/welcome.ts";
import { profileMessages } from "./messages/profile.ts";
import { categoryMessages } from "./messages/categories.ts";
import { widgetMessages } from "./messages/widgets.ts";
import { slideshowMessages } from "./messages/slideshow.ts";
import { notificationMessages } from "./messages/notifications.ts";
import { errorMessages } from "./messages/errors.ts";
import { activityMessages } from "./messages/activities.ts";
import { questionMessages } from "./messages/questions.ts";
import { configurationMessages } from "./messages/configuration.ts";
import { programmeDesignMessages } from "./messages/programme-design.ts";
import { guestbookDesignMessages } from "./messages/guestbook-design.ts";
import { settingsMessages } from "./messages/settings.ts";
import { informationMessages } from "./messages/information.ts";
import type { Locale } from "./locale.ts";
import type { Messages } from "./i18n.ts";

// Only the server and catalog tests import dictionaries; clients receive one locale.
export function getMessages(locale: Locale): Messages {
  const errors = Object.fromEntries(
    Object.entries(errorMessages[locale]).map(([key, value]) => [
      `errors.${key}`,
      value,
    ]),
  );
  // Avoid a Cartesian union of every catalog's locale-specific object type.
  return Object.assign(
    {},
    commonMessages[locale],
    adminMessages[locale],
    mediaMessages[locale],
    welcomeMessages[locale],
    profileMessages[locale],
    categoryMessages[locale],
    widgetMessages[locale],
    slideshowMessages[locale],
    notificationMessages[locale],
    activityMessages[locale],
    questionMessages[locale],
    configurationMessages[locale],
    programmeDesignMessages[locale],
    guestbookDesignMessages[locale],
    settingsMessages[locale],
    informationMessages[locale],
    errors,
  ) as Messages;
}
