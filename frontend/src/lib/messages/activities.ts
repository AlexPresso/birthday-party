const en = {
  "activities.eventType": "Event",
  "activities.eventDescription": "A name, a description and an optional time.",
  "activities.voteType": "Vote for a person",
  "activities.voteDescription":
    "Guests choose a person. You decide when to show the results.",
  "activities.overwriteConfirm":
    "This event changed since you started editing. Save your draft instead? Candidate and self-voting settings stay fixed after voting opens.",
  "activities.question": "Vote question",
  "activities.candidates": "Who can receive votes?",
  "activities.search": "Find a person",
  "activities.selected": "{count} selected · choose 2 to 200 people",
  "activities.selectAll": "Select all",
  "activities.clear": "Clear selection",
  "activities.allowSelf": "Allow voting for yourself",
  "activities.deleteConfirm": "Delete “{question}” and all its votes?",
  "activities.open": "Open voting",
  "activities.close": "Close voting",
  "activities.reveal": "Reveal results",
  "activities.openConfirm":
    "Open voting? The candidates and self-voting rule will be fixed.",
  "activities.closeConfirm":
    "Close voting? Guests will no longer be able to vote or change their choice.",
  "activities.revealConfirm": "Show the results to all guests?",
  "activities.draft": "Draft",
  "activities.draftVisibility": "Hidden from guests until voting opens.",
  "activities.openStatus": "Voting open",
  "activities.closed": "Voting closed",
  "activities.revealed": "Results",
  "activities.participation": "Votes received: {count}",
  "activities.frozen":
    "Voting has started. You can still correct the question.",
  "activities.choose": "Choose someone, then confirm your vote.",
  "activities.rules": "One choice, which you can change until voting closes.",
  "activities.noSelf": "You can’t vote for yourself.",
  "activities.voteFor": "Vote for {name}",
  "activities.confirm": "Confirm your vote",
  "activities.saved": "Your vote for {name} is saved.",
  "activities.waitResults":
    "Voting has closed. The host will reveal the results.",
  "activities.noResults": "No votes were cast.",
  "activities.votes": "Votes: {count}",
  "activities.you": "You",
  "activities.inactive": "Unavailable",
  "activities.noMatch": "No one matches your search.",
  "activities.saving": "Saving…",
  "activities.unavailable": "You can’t take part in this vote.",
  "activities.conflict":
    "This event changed. Your draft is kept; review it before saving again.",
};

type ActivityMessages = Record<keyof typeof en, string>;

const fr: ActivityMessages = {
  "activities.eventType": "Événement",
  "activities.eventDescription":
    "Un nom, une description et un horaire si tu le souhaites.",
  "activities.voteType": "Vote pour une personne",
  "activities.voteDescription":
    "Les invités choisissent une personne. Tu décides quand afficher les résultats.",
  "activities.overwriteConfirm":
    "Cet événement a changé. Enregistrer ton brouillon à la place ? Les candidats et la règle du vote pour soi-même restent inchangés si le vote a commencé.",
  "activities.question": "Question du vote",
  "activities.candidates": "Pour qui peut-on voter ?",
  "activities.search": "Rechercher une personne",
  "activities.selected": "{count} sélectionnés · choisis de 2 à 200 personnes",
  "activities.selectAll": "Tout sélectionner",
  "activities.clear": "Tout désélectionner",
  "activities.allowSelf": "Autoriser le vote pour soi-même",
  "activities.deleteConfirm": "Supprimer « {question} » et tous ses votes ?",
  "activities.open": "Ouvrir le vote",
  "activities.close": "Fermer le vote",
  "activities.reveal": "Révéler les résultats",
  "activities.openConfirm":
    "Ouvrir le vote ? Les candidats et la règle du vote pour soi-même seront fixés.",
  "activities.closeConfirm":
    "Fermer le vote ? Les invités ne pourront plus voter ni changer leur choix.",
  "activities.revealConfirm": "Afficher les résultats à tous les invités ?",
  "activities.draft": "Brouillon",
  "activities.draftVisibility": "Ce vote reste caché jusqu’à son ouverture.",
  "activities.openStatus": "Vote ouvert",
  "activities.closed": "Vote fermé",
  "activities.revealed": "Résultats",
  "activities.participation": "Votes reçus : {count}",
  "activities.frozen":
    "Le vote a commencé. Tu peux encore corriger la question.",
  "activities.choose": "Choisis une personne, puis confirme ton vote.",
  "activities.rules": "Un seul choix, modifiable jusqu’à la fermeture.",
  "activities.noSelf": "Tu ne peux pas voter pour toi-même.",
  "activities.voteFor": "Voter pour {name}",
  "activities.confirm": "Confirmer ton vote",
  "activities.saved": "Ton vote pour {name} est enregistré.",
  "activities.waitResults":
    "Le vote est fermé. L’organisateur révélera les résultats.",
  "activities.noResults": "Personne n’a voté.",
  "activities.votes": "{count} voix",
  "activities.you": "Toi",
  "activities.inactive": "Indisponible",
  "activities.noMatch": "Personne ne correspond à ta recherche.",
  "activities.saving": "Enregistrement…",
  "activities.unavailable": "Tu ne peux pas participer à ce vote.",
  "activities.conflict":
    "Cet événement a changé. Ton brouillon est conservé ; vérifie-le avant de l’enregistrer à nouveau.",
};

const de: ActivityMessages = {
  "activities.eventType": "Programmpunkt",
  "activities.eventDescription":
    "Ein Name, eine Beschreibung und eine optionale Uhrzeit.",
  "activities.voteType": "Für eine Person abstimmen",
  "activities.voteDescription":
    "Die Gäste wählen eine Person. Du entscheidest, wann die Ergebnisse erscheinen.",
  "activities.overwriteConfirm":
    "Dieser Programmpunkt wurde inzwischen geändert. Deinen Entwurf stattdessen speichern? Kandidaten und die Regel für eigene Stimmen bleiben nach Beginn der Abstimmung unverändert.",
  "activities.question": "Frage zur Abstimmung",
  "activities.candidates": "Wer steht zur Wahl?",
  "activities.search": "Person suchen",
  "activities.selected": "{count} ausgewählt · wähle 2 bis 200 Personen",
  "activities.selectAll": "Alle auswählen",
  "activities.clear": "Auswahl aufheben",
  "activities.allowSelf": "Stimmen für sich selbst erlauben",
  "activities.deleteConfirm": "„{question}“ und alle Stimmen löschen?",
  "activities.open": "Abstimmung öffnen",
  "activities.close": "Abstimmung schließen",
  "activities.reveal": "Ergebnisse zeigen",
  "activities.openConfirm":
    "Abstimmung öffnen? Die Kandidaten und die Regel für eigene Stimmen stehen dann fest.",
  "activities.closeConfirm":
    "Abstimmung schließen? Gäste können danach nicht mehr abstimmen oder ihre Wahl ändern.",
  "activities.revealConfirm": "Die Ergebnisse allen Gästen zeigen?",
  "activities.draft": "Entwurf",
  "activities.draftVisibility":
    "Bis zum Start der Abstimmung für Gäste verborgen.",
  "activities.openStatus": "Abstimmung offen",
  "activities.closed": "Abstimmung geschlossen",
  "activities.revealed": "Ergebnisse",
  "activities.participation": "Erhaltene Stimmen: {count}",
  "activities.frozen":
    "Die Abstimmung läuft bereits. Du kannst die Frage noch korrigieren.",
  "activities.choose": "Wähle eine Person und bestätige deine Stimme.",
  "activities.rules": "Eine Stimme, die du bis zum Ende ändern kannst.",
  "activities.noSelf": "Du kannst nicht für dich selbst stimmen.",
  "activities.voteFor": "Für {name} stimmen",
  "activities.confirm": "Stimme bestätigen",
  "activities.saved": "Deine Stimme für {name} ist gespeichert.",
  "activities.waitResults":
    "Die Abstimmung ist geschlossen. Der Gastgeber gibt die Ergebnisse bekannt.",
  "activities.noResults": "Es wurden keine Stimmen abgegeben.",
  "activities.votes": "Stimmen: {count}",
  "activities.you": "Du",
  "activities.inactive": "Nicht verfügbar",
  "activities.noMatch": "Niemand passt zu deiner Suche.",
  "activities.saving": "Wird gespeichert…",
  "activities.unavailable": "Du kannst an dieser Abstimmung nicht teilnehmen.",
  "activities.conflict":
    "Dieser Programmpunkt wurde geändert. Dein Entwurf bleibt erhalten; prüfe ihn vor dem erneuten Speichern.",
};

const it: ActivityMessages = {
  "activities.eventType": "Evento",
  "activities.eventDescription":
    "Un nome, una descrizione e, se vuoi, un orario.",
  "activities.voteType": "Vota una persona",
  "activities.voteDescription":
    "Gli invitati scelgono una persona. Tu decidi quando mostrare i risultati.",
  "activities.overwriteConfirm":
    "Questo evento è cambiato. Salvare la tua bozza al suo posto? I candidati e la regola sul voto per sé stessi restano invariati se la votazione è iniziata.",
  "activities.question": "Domanda della votazione",
  "activities.candidates": "Chi si può votare?",
  "activities.search": "Cerca una persona",
  "activities.selected": "{count} selezionati · scegli da 2 a 200 persone",
  "activities.selectAll": "Seleziona tutti",
  "activities.clear": "Deseleziona tutti",
  "activities.allowSelf": "Consenti di votare per sé stessi",
  "activities.deleteConfirm": "Eliminare «{question}» e tutti i suoi voti?",
  "activities.open": "Apri votazione",
  "activities.close": "Chiudi votazione",
  "activities.reveal": "Mostra risultati",
  "activities.openConfirm":
    "Aprire la votazione? I candidati e la regola sul voto per sé stessi non potranno più cambiare.",
  "activities.closeConfirm":
    "Chiudere la votazione? Gli invitati non potranno più votare né cambiare scelta.",
  "activities.revealConfirm": "Mostrare i risultati a tutti gli invitati?",
  "activities.draft": "Bozza",
  "activities.draftVisibility":
    "Nascosta agli invitati fino all’apertura della votazione.",
  "activities.openStatus": "Votazione aperta",
  "activities.closed": "Votazione chiusa",
  "activities.revealed": "Risultati",
  "activities.participation": "Voti ricevuti: {count}",
  "activities.frozen":
    "La votazione è iniziata. Puoi ancora correggere la domanda.",
  "activities.choose": "Scegli una persona, poi conferma il voto.",
  "activities.rules": "Una sola scelta, modificabile fino alla chiusura.",
  "activities.noSelf": "Non puoi votare per te stesso.",
  "activities.voteFor": "Vota per {name}",
  "activities.confirm": "Conferma il voto",
  "activities.saved": "Il tuo voto per {name} è stato salvato.",
  "activities.waitResults":
    "La votazione è chiusa. L’organizzatore mostrerà i risultati.",
  "activities.noResults": "Nessuno ha votato.",
  "activities.votes": "Voti: {count}",
  "activities.you": "Tu",
  "activities.inactive": "Non disponibile",
  "activities.noMatch": "Nessuno corrisponde alla tua ricerca.",
  "activities.saving": "Salvataggio…",
  "activities.unavailable": "Non puoi partecipare a questa votazione.",
  "activities.conflict":
    "Questo evento è cambiato. La tua bozza è conservata; controllala prima di salvarla di nuovo.",
};

const es: ActivityMessages = {
  "activities.eventType": "Evento",
  "activities.eventDescription":
    "Un nombre, una descripción y, si quieres, una hora.",
  "activities.voteType": "Votar por una persona",
  "activities.voteDescription":
    "Los invitados eligen a una persona. Tú decides cuándo mostrar los resultados.",
  "activities.overwriteConfirm":
    "Este evento ha cambiado. ¿Guardar tu borrador en su lugar? Los candidatos y la regla del voto por uno mismo no cambian si la votación ha empezado.",
  "activities.question": "Pregunta de la votación",
  "activities.candidates": "¿A quién se puede votar?",
  "activities.search": "Buscar una persona",
  "activities.selected": "{count} seleccionados · elige de 2 a 200 personas",
  "activities.selectAll": "Seleccionar a todos",
  "activities.clear": "Quitar la selección",
  "activities.allowSelf": "Permitir votar por uno mismo",
  "activities.deleteConfirm": "¿Eliminar «{question}» y todos sus votos?",
  "activities.open": "Abrir votación",
  "activities.close": "Cerrar votación",
  "activities.reveal": "Mostrar resultados",
  "activities.openConfirm":
    "¿Abrir la votación? Los candidatos y la regla del voto por uno mismo quedarán fijados.",
  "activities.closeConfirm":
    "¿Cerrar la votación? Los invitados ya no podrán votar ni cambiar su elección.",
  "activities.revealConfirm": "¿Mostrar los resultados a todos los invitados?",
  "activities.draft": "Borrador",
  "activities.draftVisibility":
    "Oculta a los invitados hasta que abras la votación.",
  "activities.openStatus": "Votación abierta",
  "activities.closed": "Votación cerrada",
  "activities.revealed": "Resultados",
  "activities.participation": "Votos recibidos: {count}",
  "activities.frozen":
    "La votación ha empezado. Todavía puedes corregir la pregunta.",
  "activities.choose": "Elige una persona y confirma tu voto.",
  "activities.rules": "Una sola elección, que puedes cambiar hasta el cierre.",
  "activities.noSelf": "No puedes votar por ti mismo.",
  "activities.voteFor": "Votar por {name}",
  "activities.confirm": "Confirmar tu voto",
  "activities.saved": "Tu voto por {name} se ha guardado.",
  "activities.waitResults":
    "La votación está cerrada. Quien organiza mostrará los resultados.",
  "activities.noResults": "Nadie ha votado.",
  "activities.votes": "Votos: {count}",
  "activities.you": "Tú",
  "activities.inactive": "No disponible",
  "activities.noMatch": "Nadie coincide con tu búsqueda.",
  "activities.saving": "Guardando…",
  "activities.unavailable": "No puedes participar en esta votación.",
  "activities.conflict":
    "Este evento ha cambiado. Tu borrador se conserva; revísalo antes de volver a guardarlo.",
};

export const activityMessages = { en, fr, de, it, es };
