const en = {
  "guestbookDesign.description": "A few words to celebrate turning {age}.",
  "guestbookDesign.placeholder": "Your message…",
  "guestbookDesign.publish": "Post",
  "guestbookDesign.actions": "Message options",
  "guestbookDesign.emptyMessage": "Write a message before posting.",
  "guestbookDesign.copy": "Copy message",
  "guestbookDesign.copied": "Copied",
  "guestbookDesign.copyFailed": "Couldn't copy the message. Try again.",
};

type Key = keyof typeof en;

export const guestbookDesignMessages = {
  en,
  fr: {
    "guestbookDesign.description": "Un mot pour les {age} ans.",
    "guestbookDesign.placeholder": "Ton message…",
    "guestbookDesign.publish": "Publier",
    "guestbookDesign.actions": "Options du message",
    "guestbookDesign.emptyMessage": "Écris un message avant de publier.",
    "guestbookDesign.copy": "Copier le message",
    "guestbookDesign.copied": "Copié",
    "guestbookDesign.copyFailed": "Impossible de copier le message. Réessaie.",
  },
  de: {
    "guestbookDesign.description": "Ein paar Worte zum {age}. Geburtstag.",
    "guestbookDesign.placeholder": "Deine Nachricht…",
    "guestbookDesign.publish": "Veröffentlichen",
    "guestbookDesign.actions": "Nachrichtenoptionen",
    "guestbookDesign.emptyMessage":
      "Schreib eine Nachricht, bevor du sie veröffentlichst.",
    "guestbookDesign.copy": "Nachricht kopieren",
    "guestbookDesign.copied": "Kopiert",
    "guestbookDesign.copyFailed":
      "Die Nachricht konnte nicht kopiert werden. Versuche es erneut.",
  },
  it: {
    "guestbookDesign.description": "Un pensiero per i {age} anni.",
    "guestbookDesign.placeholder": "Il tuo messaggio…",
    "guestbookDesign.publish": "Pubblica",
    "guestbookDesign.actions": "Opzioni del messaggio",
    "guestbookDesign.emptyMessage": "Scrivi un messaggio prima di pubblicarlo.",
    "guestbookDesign.copy": "Copia il messaggio",
    "guestbookDesign.copied": "Copiato",
    "guestbookDesign.copyFailed":
      "Non è stato possibile copiare il messaggio. Riprova.",
  },
  es: {
    "guestbookDesign.description": "Unas palabras para los {age} años.",
    "guestbookDesign.placeholder": "Tu mensaje…",
    "guestbookDesign.publish": "Publicar",
    "guestbookDesign.actions": "Opciones del mensaje",
    "guestbookDesign.emptyMessage": "Escribe un mensaje antes de publicarlo.",
    "guestbookDesign.copy": "Copiar mensaje",
    "guestbookDesign.copied": "Copiado",
    "guestbookDesign.copyFailed":
      "No se pudo copiar el mensaje. Inténtalo de nuevo.",
  },
} satisfies Record<"en" | "fr" | "de" | "it" | "es", Record<Key, string>>;
