const messages = {
  en: {
    title: "Birthday party",
    welcome_step: "The next step is ready. Open the app to continue.",
    welcome_open: "The app is open. Come back when you’re ready.",
    surprise: "Surprise",
    programme_start: "It’s starting.",
    programme_unlock: "It’s revealed.",
  },
  fr: {
    title: "La fête",
    welcome_step: "La suite est prête. Ouvre l’application pour continuer.",
    welcome_open: "L’application est ouverte. Reviens quand tu veux.",
    surprise: "Surprise",
    programme_start: "Ça commence.",
    programme_unlock: "C’est dévoilé.",
  },
  de: {
    title: "Geburtstagsfeier",
    welcome_step:
      "Der nächste Schritt ist bereit. Öffne die App, um weiterzumachen.",
    welcome_open: "Die App ist geöffnet. Komm zurück, wenn du bereit bist.",
    surprise: "Überraschung",
    programme_start: "Es geht los.",
    programme_unlock: "Nicht mehr geheim.",
  },
  it: {
    title: "La festa",
    welcome_step: "Il prossimo passaggio è pronto. Apri l’app per continuare.",
    welcome_open: "L’app è aperta. Torna quando vuoi.",
    surprise: "Sorpresa",
    programme_start: "Si comincia.",
    programme_unlock: "È svelato.",
  },
  es: {
    title: "La fiesta",
    welcome_step: "El siguiente paso está listo. Abre la app para continuar.",
    welcome_open: "La app está abierta. Vuelve cuando quieras.",
    surprise: "Sorpresa",
    programme_start: "Ya empieza.",
    programme_unlock: "Ya se ha revelado.",
  },
};

// A programme payload carries an event title of up to 160 characters, each up
// to six characters long once escaped in JSON.
const maxPayloadLength = 2048;
const welcomeTypes = ["welcome_step", "welcome_open"];
const programmeTypes = ["programme_start", "programme_unlock"];
// The tag of a programme notification also tells a click where to go.
const programmeTag = "birthday-programme-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const raw = event.data.text();
  if (raw.length > maxPayloadLength) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.locale !== "string" ||
    !Object.hasOwn(messages, payload.locale)
  ) {
    return;
  }

  const copy = messages[payload.locale];
  const fields = Object.keys(payload).length;
  let title;
  let tag;
  if (welcomeTypes.includes(payload.type) && fields === 2) {
    title = copy.title;
    tag = "birthday-welcome";
  } else if (
    programmeTypes.includes(payload.type) &&
    fields === 4 &&
    typeof payload.title === "string" &&
    Number.isSafeInteger(payload.eventId) &&
    payload.eventId > 0
  ) {
    // The event's name is the host's text, shown as written. A surprise that
    // is still hidden has none.
    title = payload.title || copy.surprise;
    // One notification per event and moment, so events do not replace each other.
    tag = `${programmeTag}${payload.eventId}-${payload.type}`;
  } else {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: copy[payload.type],
      lang: payload.locale,
      icon: "/icons/app-192.png",
      tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only the tag this worker wrote chooses the page, never a URL in the data.
  const programme = event.notification.tag.startsWith(programmeTag);
  event.waitUntil(openPage(programme ? "/programme" : "/attente"));
});

async function openPage(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    const current = new URL(client.url);
    if (current.origin !== self.location.origin) continue;
    try {
      if (current.pathname === path) return await client.focus();
      const navigated = await client.navigate(target);
      if (navigated) return await navigated.focus();
    } catch {
      // A tab may close between enumeration and navigation.
    }
  }
  return self.clients.openWindow(target);
}
