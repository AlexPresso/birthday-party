const en = {
  request_forbidden: "This action isn’t allowed.",
  invitation_required: "Open your invitation to sign in.",
  session_expired:
    "Your session has expired. Ask the host for a new invitation.",
  admin_required: "Only the host can access this area.",
  invalid_body: "We couldn’t read what you sent. Try again.",
  internal_error: "Something went wrong. Try again in a moment.",
  invalid_id: "We couldn’t find this item. Refresh the page.",
  invalid_cursor: "This page could not be loaded. Refresh the page.",
  invalid_page_size: "This page couldn’t load. Refresh it and try again.",
  not_found: "This item could not be found.",
  invalid_party:
    "The title can contain up to 120 characters and the location up to 240.",
  invalid_timezone: "Choose a time zone such as Europe/Zurich.",
  unknown_timezone: "This time zone was not found. Try Europe/Zurich.",
  invalid_date: "Choose the date and time again, then save.",
  invalid_event:
    "Add a title (up to 160 characters). The description and hint are optional (up to 4000 and 160 characters).",
  event_limit_reached: "You’ve reached the limit of 200 events.",
  invalid_message: "Your message must contain between 1 and 2000 characters.",
  message_not_found: "This message could not be found.",
  message_delete_forbidden: "You can only delete your own messages.",
  too_many_attempts: "Too many attempts. Try again in a minute.",
  invalid_invitation:
    "This link is invalid or has expired. Ask the host for a new invitation.",
  invitation_unavailable:
    "This link is invalid, expired or already used. Ask the host for a new invitation.",
  invitation_used:
    "This invitation has already been used. Ask the host for a new one.",
  invalid_guest_name: "The name must contain between 1 and 80 characters.",
  guest_limit_reached: "You’ve reached the limit of 500 guests.",
  self_revoke_forbidden: "You cannot remove your own access.",
  upload_busy: "Two photos are already being processed. Try again in a moment.",
  photo_required: "Choose a photo to upload.",
  single_photo_required: "Upload one photo at a time.",
  photo_too_large: "This photo is larger than 15 MB. Choose a smaller file.",
  photo_upload_failed: "The photo didn’t upload. Try again.",
  unsupported_photo_type: "Choose a JPEG, PNG or WebP photo.",
  photo_dimensions_too_large:
    "This photo exceeds 40 megapixels. Choose a smaller image.",
  unreadable_photo: "This photo could not be read. Choose another image.",
  album_full: "The album is full (5000 photos or 10 GB). Contact the host.",
  access_revoked: "You no longer have access to the party. Contact the host.",
  photo_not_found: "This photo could not be found.",
  photo_unavailable: "This photo is no longer available.",
  photo_delete_forbidden: "You can only delete your own photos.",
  upload_type:
    "Choose a JPEG, PNG or WebP photo. Convert HEIC files to JPEG first.",
  upload_size: "This photo is larger than 15 MB. Choose a smaller file.",
  upload_empty: "This file is empty. Choose another photo.",
};

export type ErrorCode = keyof typeof en;

export const errorMessages = {
  en,
  fr: {
    request_forbidden: "Cette action n’est pas autorisée.",
    invitation_required: "Connecte-toi avec ton invitation.",
    session_expired:
      "Ta connexion a expiré. Demande un nouveau lien à l’organisateur.",
    admin_required: "Cet espace est réservé à l’organisateur.",
    invalid_body: "Impossible de lire ce que tu as envoyé. Réessaie.",
    internal_error: "Ça n’a pas fonctionné. Réessaie dans un instant.",
    invalid_id: "Impossible de trouver cet élément. Actualise la page.",
    invalid_cursor: "Cette page n’a pas pu être chargée. Actualise la page.",
    invalid_page_size:
      "La page n’a pas pu se charger. Actualise-la et réessaie.",
    not_found: "Cet élément est introuvable.",
    invalid_party:
      "Le titre peut contenir jusqu’à 120 caractères et le lieu jusqu’à 240.",
    invalid_timezone: "Choisis un fuseau horaire, par exemple Europe/Zurich.",
    unknown_timezone: "Ce fuseau horaire est inconnu. Essaie Europe/Zurich.",
    invalid_date: "Choisis à nouveau la date et l’heure, puis enregistre.",
    invalid_event:
      "Ajoute un titre (160 caractères maximum). La description et l’indice sont facultatifs (4000 et 160 caractères maximum).",
    event_limit_reached: "Tu as atteint la limite de 200 événements.",
    invalid_message: "Ton message doit contenir entre 1 et 2000 caractères.",
    message_not_found: "Ce message est introuvable.",
    message_delete_forbidden:
      "Tu peux seulement supprimer tes propres messages.",
    too_many_attempts: "Trop de tentatives. Réessaie dans une minute.",
    invalid_invitation:
      "Ce lien est invalide ou a expiré. Demande un nouveau lien à l’organisateur.",
    invitation_unavailable:
      "Ce lien est invalide, expiré ou déjà utilisé. Demande un nouveau lien à l’organisateur.",
    invitation_used:
      "Cette invitation a déjà été utilisée. Demande un nouveau lien à l’organisateur.",
    invalid_guest_name: "Le prénom doit contenir entre 1 et 80 caractères.",
    guest_limit_reached: "Tu as atteint la limite de 500 invités.",
    self_revoke_forbidden: "Tu ne peux pas retirer ton propre accès.",
    upload_busy:
      "Deux photos sont déjà en cours de traitement. Réessaie dans un instant.",
    photo_required: "Choisis une photo à envoyer.",
    single_photo_required: "Envoie une seule photo à la fois.",
    photo_too_large: "La photo dépasse 15 Mo. Choisis un fichier plus petit.",
    photo_upload_failed: "La photo n’a pas été envoyée. Réessaie.",
    unsupported_photo_type: "Choisis une photo JPEG, PNG ou WebP.",
    photo_dimensions_too_large:
      "La photo dépasse 40 mégapixels. Choisis une image plus petite.",
    unreadable_photo: "Cette photo est illisible. Choisis une autre image.",
    album_full:
      "L’album est plein (5000 photos ou 10 Go). Contacte l’organisateur.",
    access_revoked: "Tu n’as plus accès à la fête. Contacte l’organisateur.",
    photo_not_found: "Cette photo est introuvable.",
    photo_unavailable: "Cette photo n’est plus disponible.",
    photo_delete_forbidden: "Tu peux seulement supprimer tes propres photos.",
    upload_type:
      "Choisis une photo JPEG, PNG ou WebP. Convertis d’abord les fichiers HEIC en JPEG.",
    upload_size: "La photo dépasse 15 Mo. Choisis un fichier plus petit.",
    upload_empty: "Ce fichier est vide. Choisis une autre photo.",
  },
  de: {
    request_forbidden: "Diese Aktion ist nicht erlaubt.",
    invitation_required: "Öffne deine Einladung, um dich anzumelden.",
    session_expired:
      "Deine Sitzung ist abgelaufen. Bitte den Gastgeber um eine neue Einladung.",
    admin_required: "Dieser Bereich ist dem Gastgeber vorbehalten.",
    invalid_body:
      "Wir konnten deine Angaben nicht lesen. Versuch es noch einmal.",
    internal_error: "Etwas ist schiefgelaufen. Versuch es gleich noch einmal.",
    invalid_id: "Wir konnten diesen Eintrag nicht finden. Lade die Seite neu.",
    invalid_cursor: "Diese Seite konnte nicht geladen werden. Lade sie neu.",
    invalid_page_size:
      "Die Seite konnte nicht geladen werden. Lade sie neu und versuch es noch einmal.",
    not_found: "Dieser Eintrag wurde nicht gefunden.",
    invalid_party:
      "Der Titel darf höchstens 120 Zeichen enthalten, der Ort höchstens 240.",
    invalid_timezone: "Wähle eine Zeitzone, zum Beispiel Europe/Zurich.",
    unknown_timezone:
      "Diese Zeitzone wurde nicht gefunden. Versuch es mit Europe/Zurich.",
    invalid_date: "Wähle Datum und Uhrzeit erneut aus und speichere.",
    invalid_event:
      "Gib einen Titel mit höchstens 160 Zeichen ein. Beschreibung: höchstens 4000, Hinweis: höchstens 160 Zeichen.",
    event_limit_reached: "Du hast das Limit von 200 Programmpunkten erreicht.",
    invalid_message: "Dein Eintrag muss zwischen 1 und 2000 Zeichen enthalten.",
    message_not_found: "Dieser Eintrag wurde nicht gefunden.",
    message_delete_forbidden: "Du kannst nur deine eigenen Einträge löschen.",
    too_many_attempts:
      "Zu viele Versuche. Versuch es in einer Minute noch einmal.",
    invalid_invitation:
      "Dieser Link ist ungültig oder abgelaufen. Bitte den Gastgeber um eine neue Einladung.",
    invitation_unavailable:
      "Dieser Link ist ungültig, abgelaufen oder bereits benutzt. Bitte den Gastgeber um eine neue Einladung.",
    invitation_used:
      "Diese Einladung wurde bereits benutzt. Bitte den Gastgeber um einen neuen Link.",
    invalid_guest_name: "Der Name muss zwischen 1 und 80 Zeichen enthalten.",
    guest_limit_reached: "Du hast das Limit von 500 Gästen erreicht.",
    self_revoke_forbidden: "Du kannst deinen eigenen Zugang nicht entfernen.",
    upload_busy:
      "Es werden bereits zwei Fotos verarbeitet. Versuch es gleich noch einmal.",
    photo_required: "Wähle ein Foto zum Hochladen.",
    single_photo_required: "Lade jeweils nur ein Foto hoch.",
    photo_too_large:
      "Dieses Foto ist größer als 15 MB. Wähle eine kleinere Datei.",
    photo_upload_failed:
      "Das Foto konnte nicht hochgeladen werden. Versuch es noch einmal.",
    unsupported_photo_type: "Wähle ein Foto im Format JPEG, PNG oder WebP.",
    photo_dimensions_too_large:
      "Dieses Foto hat mehr als 40 Megapixel. Wähle ein kleineres Bild.",
    unreadable_photo:
      "Dieses Foto konnte nicht gelesen werden. Wähle ein anderes Bild.",
    album_full:
      "Das Album ist voll (5000 Fotos oder 10 GB). Melde dich beim Gastgeber.",
    access_revoked:
      "Du hast keinen Zugang mehr zur Feier. Melde dich beim Gastgeber.",
    photo_not_found: "Dieses Foto wurde nicht gefunden.",
    photo_unavailable: "Dieses Foto ist nicht mehr verfügbar.",
    photo_delete_forbidden: "Du kannst nur deine eigenen Fotos löschen.",
    upload_type:
      "Wähle ein Foto im Format JPEG, PNG oder WebP. Wandle HEIC-Dateien zuerst in JPEG um.",
    upload_size: "Dieses Foto ist größer als 15 MB. Wähle eine kleinere Datei.",
    upload_empty: "Diese Datei ist leer. Wähle ein anderes Foto.",
  },
  it: {
    request_forbidden: "Questa azione non è consentita.",
    invitation_required: "Apri il tuo invito per accedere.",
    session_expired:
      "La tua sessione è scaduta. Chiedi un nuovo invito a chi organizza.",
    admin_required: "Quest’area è riservata a chi organizza.",
    invalid_body: "Non riusciamo a leggere ciò che hai inviato. Riprova.",
    internal_error: "Qualcosa è andato storto. Riprova tra poco.",
    invalid_id: "Non troviamo questo elemento. Ricarica la pagina.",
    invalid_cursor: "Non è stato possibile caricare questa pagina. Ricaricala.",
    invalid_page_size: "La pagina non si è caricata. Ricaricala e riprova.",
    not_found: "Questo elemento non è stato trovato.",
    invalid_party:
      "Il titolo può contenere fino a 120 caratteri e il luogo fino a 240.",
    invalid_timezone: "Scegli un fuso orario, per esempio Europe/Zurich.",
    unknown_timezone:
      "Questo fuso orario non è stato trovato. Prova Europe/Zurich.",
    invalid_date: "Seleziona di nuovo la data e l’ora, poi salva.",
    invalid_event:
      "Aggiungi un titolo (massimo 160 caratteri). Descrizione e indizio sono facoltativi (massimo 4000 e 160 caratteri).",
    event_limit_reached: "Hai raggiunto il limite di 200 eventi.",
    invalid_message: "Il tuo messaggio deve contenere da 1 a 2000 caratteri.",
    message_not_found: "Questo messaggio non è stato trovato.",
    message_delete_forbidden: "Puoi eliminare solo i tuoi messaggi.",
    too_many_attempts: "Troppi tentativi. Riprova tra un minuto.",
    invalid_invitation:
      "Questo link non è valido o è scaduto. Chiedi un nuovo invito a chi organizza.",
    invitation_unavailable:
      "Questo link non è valido, è scaduto o è già stato usato. Chiedi un nuovo invito a chi organizza.",
    invitation_used:
      "Questo invito è già stato usato. Chiedi un nuovo link a chi organizza.",
    invalid_guest_name: "Il nome deve contenere da 1 a 80 caratteri.",
    guest_limit_reached: "Hai raggiunto il limite di 500 invitati.",
    self_revoke_forbidden: "Non puoi rimuovere il tuo accesso.",
    upload_busy: "Due foto sono già in elaborazione. Riprova tra poco.",
    photo_required: "Scegli una foto da caricare.",
    single_photo_required: "Carica una sola foto alla volta.",
    photo_too_large: "Questa foto supera i 15 MB. Scegli un file più piccolo.",
    photo_upload_failed: "La foto non è stata caricata. Riprova.",
    unsupported_photo_type: "Scegli una foto JPEG, PNG o WebP.",
    photo_dimensions_too_large:
      "Questa foto supera i 40 megapixel. Scegli un’immagine più piccola.",
    unreadable_photo: "Questa foto non è leggibile. Scegli un’altra immagine.",
    album_full: "L’album è pieno (5000 foto o 10 GB). Contatta chi organizza.",
    access_revoked: "Non hai più accesso alla festa. Contatta chi organizza.",
    photo_not_found: "Questa foto non è stata trovata.",
    photo_unavailable: "Questa foto non è più disponibile.",
    photo_delete_forbidden: "Puoi eliminare solo le tue foto.",
    upload_type:
      "Scegli una foto JPEG, PNG o WebP. Converti prima i file HEIC in JPEG.",
    upload_size: "Questa foto supera i 15 MB. Scegli un file più piccolo.",
    upload_empty: "Questo file è vuoto. Scegli un’altra foto.",
  },
  es: {
    request_forbidden: "Esta acción no está permitida.",
    invitation_required: "Abre tu invitación para entrar.",
    session_expired:
      "Tu sesión ha caducado. Pide una nueva invitación a quien organiza.",
    admin_required: "Esta sección está reservada para quien organiza.",
    invalid_body: "No podemos leer lo que has enviado. Inténtalo de nuevo.",
    internal_error: "Algo ha fallado. Vuelve a intentarlo en un momento.",
    invalid_id: "No encontramos este elemento. Recarga la página.",
    invalid_cursor: "No se ha podido cargar esta página. Recárgala.",
    invalid_page_size:
      "La página no se ha cargado. Recárgala e inténtalo de nuevo.",
    not_found: "No se ha encontrado este elemento.",
    invalid_party:
      "El título puede tener hasta 120 caracteres y el lugar hasta 240.",
    invalid_timezone: "Elige una zona horaria, por ejemplo Europe/Zurich.",
    unknown_timezone:
      "No se ha encontrado esta zona horaria. Prueba con Europe/Zurich.",
    invalid_date: "Vuelve a elegir la fecha y la hora y guarda los cambios.",
    invalid_event:
      "Añade un título (hasta 160 caracteres). La descripción y la pista son opcionales (hasta 4000 y 160 caracteres).",
    event_limit_reached: "Has llegado al límite de 200 eventos.",
    invalid_message: "Tu mensaje debe tener entre 1 y 2000 caracteres.",
    message_not_found: "No se ha encontrado este mensaje.",
    message_delete_forbidden: "Solo puedes borrar tus propios mensajes.",
    too_many_attempts: "Demasiados intentos. Vuelve a intentarlo en un minuto.",
    invalid_invitation:
      "Este enlace no es válido o ha caducado. Pide una nueva invitación a quien organiza.",
    invitation_unavailable:
      "Este enlace no es válido, ha caducado o ya se ha usado. Pide una nueva invitación a quien organiza.",
    invitation_used:
      "Esta invitación ya se ha usado. Pide un nuevo enlace a quien organiza.",
    invalid_guest_name: "El nombre debe tener entre 1 y 80 caracteres.",
    guest_limit_reached: "Has llegado al límite de 500 invitados.",
    self_revoke_forbidden: "No puedes quitarte tu propio acceso.",
    upload_busy:
      "Ya se están procesando dos fotos. Inténtalo de nuevo en un momento.",
    photo_required: "Elige una foto para subir.",
    single_photo_required: "Sube una sola foto cada vez.",
    photo_too_large:
      "Esta foto supera los 15 MB. Elige un archivo más pequeño.",
    photo_upload_failed: "No se ha podido subir la foto. Inténtalo de nuevo.",
    unsupported_photo_type: "Elige una foto JPEG, PNG o WebP.",
    photo_dimensions_too_large:
      "Esta foto supera los 40 megapíxeles. Elige una imagen más pequeña.",
    unreadable_photo: "No se ha podido leer esta foto. Elige otra imagen.",
    album_full:
      "El álbum está lleno (5000 fotos o 10 GB). Contacta con quien organiza.",
    access_revoked:
      "Ya no tienes acceso a la fiesta. Contacta con quien organiza.",
    photo_not_found: "No se ha encontrado esta foto.",
    photo_unavailable: "Esta foto ya no está disponible.",
    photo_delete_forbidden: "Solo puedes borrar tus propias fotos.",
    upload_type:
      "Elige una foto JPEG, PNG o WebP. Convierte primero los archivos HEIC a JPEG.",
    upload_size: "Esta foto supera los 15 MB. Elige un archivo más pequeño.",
    upload_empty: "Este archivo está vacío. Elige otra foto.",
  },
} satisfies Record<"fr" | "en" | "de" | "it" | "es", Record<ErrorCode, string>>;
