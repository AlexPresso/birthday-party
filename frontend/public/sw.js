const messages = {
  en: {
    title: "Birthday party",
    welcome_step: "The next step is ready. Open the app to continue.",
    welcome_open: "The app is open. Come back when you’re ready.",
  },
  fr: {
    title: "La fête",
    welcome_step: "La suite est prête. Ouvre l’application pour continuer.",
    welcome_open: "L’application est ouverte. Reviens quand tu veux.",
  },
  de: {
    title: "Geburtstagsfeier",
    welcome_step:
      "Der nächste Schritt ist bereit. Öffne die App, um weiterzumachen.",
    welcome_open: "Die App ist geöffnet. Komm zurück, wenn du bereit bist.",
  },
  it: {
    title: "La festa",
    welcome_step: "Il prossimo passaggio è pronto. Apri l’app per continuare.",
    welcome_open: "L’app è aperta. Torna quando vuoi.",
  },
  es: {
    title: "La fiesta",
    welcome_step: "El siguiente paso está listo. Abre la app para continuar.",
    welcome_open: "La app está abierta. Vuelve cuando quieras.",
  },
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const raw = event.data.text();
  if (raw.length > 256) return;

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
    Object.keys(payload).length !== 2 ||
    typeof payload.locale !== "string" ||
    !Object.hasOwn(messages, payload.locale) ||
    !["welcome_step", "welcome_open"].includes(payload.type)
  ) {
    return;
  }

  const copy = messages[payload.locale];
  event.waitUntil(
    self.registration.showNotification(copy.title, {
      body: copy[payload.type],
      lang: payload.locale,
      icon: "/icons/app-192.png",
      tag: "birthday-welcome",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openWelcome());
});

async function openWelcome() {
  const target = new URL("/attente", self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    const current = new URL(client.url);
    if (current.origin !== self.location.origin) continue;
    try {
      if (current.pathname === "/attente") return await client.focus();
      const navigated = await client.navigate(target);
      if (navigated) return await navigated.focus();
    } catch {
      // A tab may close between enumeration and navigation.
    }
  }
  return self.clients.openWindow(target);
}
