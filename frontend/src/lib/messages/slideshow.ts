const en = {
  "slideshow.start": "Start slideshow",
  "slideshow.title": "Slideshow",
  "slideshow.close": "Close slideshow",
  "slideshow.pause": "Pause",
  "slideshow.resume": "Resume",
  "slideshow.fullscreen": "Full screen",
  "slideshow.exitFullscreen": "Exit full screen",
  "slideshow.fullscreenError":
    "Full screen is unavailable. You can keep watching here.",
  "slideshow.loading": "Loading…",
  "slideshow.retry": "Try again",
  "slideshow.mediaError":
    "This file couldn’t be loaded. Try again or skip to the next one.",
  "slideshow.playbackBlocked": "Tap Resume to play the video.",
};

type SlideshowMessages = Record<keyof typeof en, string>;

const fr: SlideshowMessages = {
  "slideshow.start": "Lancer le diaporama",
  "slideshow.title": "Diaporama",
  "slideshow.close": "Fermer le diaporama",
  "slideshow.pause": "Mettre en pause",
  "slideshow.resume": "Reprendre",
  "slideshow.fullscreen": "Plein écran",
  "slideshow.exitFullscreen": "Quitter le plein écran",
  "slideshow.fullscreenError":
    "Le plein écran n’est pas disponible. Tu peux continuer ici.",
  "slideshow.loading": "Chargement…",
  "slideshow.retry": "Réessayer",
  "slideshow.mediaError":
    "Ce fichier n’a pas pu être chargé. Réessaie ou passe au suivant.",
  "slideshow.playbackBlocked": "Appuie sur Reprendre pour lire la vidéo.",
};

const de: SlideshowMessages = {
  "slideshow.start": "Diashow starten",
  "slideshow.title": "Diashow",
  "slideshow.close": "Diashow schließen",
  "slideshow.pause": "Pausieren",
  "slideshow.resume": "Fortsetzen",
  "slideshow.fullscreen": "Vollbild",
  "slideshow.exitFullscreen": "Vollbild beenden",
  "slideshow.fullscreenError":
    "Vollbild ist nicht verfügbar. Du kannst hier weiterschauen.",
  "slideshow.loading": "Wird geladen…",
  "slideshow.retry": "Erneut versuchen",
  "slideshow.mediaError":
    "Diese Datei konnte nicht geladen werden. Versuch es erneut oder geh zur nächsten.",
  "slideshow.playbackBlocked":
    "Tippe auf Fortsetzen, um das Video abzuspielen.",
};

const it: SlideshowMessages = {
  "slideshow.start": "Avvia presentazione",
  "slideshow.title": "Presentazione",
  "slideshow.close": "Chiudi presentazione",
  "slideshow.pause": "Metti in pausa",
  "slideshow.resume": "Riprendi",
  "slideshow.fullscreen": "Schermo intero",
  "slideshow.exitFullscreen": "Esci dallo schermo intero",
  "slideshow.fullscreenError":
    "Lo schermo intero non è disponibile. Puoi continuare qui.",
  "slideshow.loading": "Caricamento…",
  "slideshow.retry": "Riprova",
  "slideshow.mediaError":
    "Non è stato possibile caricare questo file. Riprova o passa al successivo.",
  "slideshow.playbackBlocked": "Tocca Riprendi per avviare il video.",
};

const es: SlideshowMessages = {
  "slideshow.start": "Iniciar presentación",
  "slideshow.title": "Presentación",
  "slideshow.close": "Cerrar presentación",
  "slideshow.pause": "Pausar",
  "slideshow.resume": "Reanudar",
  "slideshow.fullscreen": "Pantalla completa",
  "slideshow.exitFullscreen": "Salir de pantalla completa",
  "slideshow.fullscreenError":
    "La pantalla completa no está disponible. Puedes seguir aquí.",
  "slideshow.loading": "Cargando…",
  "slideshow.retry": "Reintentar",
  "slideshow.mediaError":
    "No se ha podido cargar este archivo. Inténtalo de nuevo o pasa al siguiente.",
  "slideshow.playbackBlocked": "Pulsa Reanudar para reproducir el vídeo.",
};

export const slideshowMessages = { en, fr, de, it, es };
