const en = {
  "programme.agenda": "The schedule",
  "programme.noTime": "Time not set",
  "programme.vote": "Vote",
  "programme.changeVote": "Change my vote",
  "programme.viewVote": "View vote",
  "programme.hideVote": "Hide vote",
  "programme.unlockTime": "Available at {time}",
};

type ProgrammeDesignMessages = Record<keyof typeof en, string>;

export const programmeDesignMessages = {
  en,
  fr: {
    "programme.agenda": "Les rendez-vous",
    "programme.noTime": "Horaire non défini",
    "programme.vote": "Voter",
    "programme.changeVote": "Modifier mon vote",
    "programme.viewVote": "Voir le vote",
    "programme.hideVote": "Masquer le vote",
    "programme.unlockTime": "À découvrir à {time}",
  },
  de: {
    "programme.agenda": "Die Programmpunkte",
    "programme.noTime": "Keine Uhrzeit festgelegt",
    "programme.vote": "Abstimmen",
    "programme.changeVote": "Meine Stimme ändern",
    "programme.viewVote": "Abstimmung ansehen",
    "programme.hideVote": "Abstimmung ausblenden",
    "programme.unlockTime": "Ab {time} verfügbar",
  },
  it: {
    "programme.agenda": "Gli appuntamenti",
    "programme.noTime": "Orario non definito",
    "programme.vote": "Vota",
    "programme.changeVote": "Cambia il mio voto",
    "programme.viewVote": "Vedi il voto",
    "programme.hideVote": "Nascondi il voto",
    "programme.unlockTime": "Da scoprire alle {time}",
  },
  es: {
    "programme.agenda": "Los encuentros",
    "programme.noTime": "Horario sin definir",
    "programme.vote": "Votar",
    "programme.changeVote": "Cambiar mi voto",
    "programme.viewVote": "Ver la votación",
    "programme.hideVote": "Ocultar la votación",
    "programme.unlockTime": "Disponible a las {time}",
  },
} satisfies Record<"en" | "fr" | "de" | "it" | "es", ProgrammeDesignMessages>;
