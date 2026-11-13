// The root error page replaces the layout that provides translations, so it
// reads its copy from this small catalog. The common catalog spreads the same
// entries, which keeps one definition per message.
export const globalErrorMessages = {
  en: {
    "common.retry": "Try again",
    "error.title": "Can't load the page",
    "error.description": "Try again in a moment.",
  },
  fr: {
    "common.retry": "Réessayer",
    "error.title": "Impossible de charger la page",
    "error.description": "Réessaie dans un instant.",
  },
  de: {
    "common.retry": "Erneut versuchen",
    "error.title": "Die Seite konnte nicht geladen werden",
    "error.description": "Versuche es gleich noch einmal.",
  },
  it: {
    "common.retry": "Riprova",
    "error.title": "Impossibile caricare la pagina",
    "error.description": "Riprova tra un momento.",
  },
  es: {
    "common.retry": "Volver a intentar",
    "error.title": "No se puede cargar la página",
    "error.description": "Inténtalo de nuevo en un momento.",
  },
};
