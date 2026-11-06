import type { commonMessages } from "./messages/common";
import type { adminMessages } from "./messages/admin";
import type { mediaMessages } from "./messages/media";
import type { welcomeMessages } from "./messages/welcome";
import type { profileMessages } from "./messages/profile";
import type { categoryMessages } from "./messages/categories";
import type { widgetMessages } from "./messages/widgets";
import type { slideshowMessages } from "./messages/slideshow";
import type { notificationMessages } from "./messages/notifications";
import type { ErrorCode } from "./messages/errors";
import type { activityMessages } from "./messages/activities";
import type { questionMessages } from "./messages/questions";
import type { configurationMessages } from "./messages/configuration";
import type { programmeDesignMessages } from "./messages/programme-design";
import type { guestbookDesignMessages } from "./messages/guestbook-design";
import type { settingsMessages } from "./messages/settings";

export type MessageKey =
  | keyof typeof commonMessages.en
  | keyof typeof adminMessages.en
  | keyof typeof mediaMessages.en
  | keyof typeof welcomeMessages.en
  | keyof typeof profileMessages.en
  | keyof typeof categoryMessages.en
  | keyof typeof widgetMessages.en
  | keyof typeof slideshowMessages.en
  | keyof typeof notificationMessages.en
  | keyof typeof activityMessages.en
  | keyof typeof questionMessages.en
  | keyof typeof configurationMessages.en
  | keyof typeof programmeDesignMessages.en
  | keyof typeof guestbookDesignMessages.en
  | keyof typeof settingsMessages.en
  | `errors.${ErrorCode}`;
export type Messages = Record<MessageKey, string>;
export type Translator = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

export function createTranslator(messages: Messages): Translator {
  return (key, values) =>
    (messages[key] ?? messages["common.actionFailed"]).replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) =>
        values?.[name] !== undefined ? String(values[name]) : placeholder,
    );
}
