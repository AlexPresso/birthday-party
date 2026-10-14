import type { commonMessages } from "./messages/common";
import type { adminMessages } from "./messages/admin";
import type { mediaMessages } from "./messages/media";
import type { ErrorCode } from "./messages/errors";

export type MessageKey =
  | keyof typeof commonMessages.en
  | keyof typeof adminMessages.en
  | keyof typeof mediaMessages.en
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
