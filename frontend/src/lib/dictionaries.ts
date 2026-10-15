import { commonMessages } from "./messages/common.ts";
import { adminMessages } from "./messages/admin.ts";
import { mediaMessages } from "./messages/media.ts";
import { welcomeMessages } from "./messages/welcome.ts";
import { profileMessages } from "./messages/profile.ts";
import { categoryMessages } from "./messages/categories.ts";
import { errorMessages } from "./messages/errors.ts";
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
  return {
    ...commonMessages[locale],
    ...adminMessages[locale],
    ...mediaMessages[locale],
    ...welcomeMessages[locale],
    ...profileMessages[locale],
    ...categoryMessages[locale],
    ...errors,
  } as Messages;
}
