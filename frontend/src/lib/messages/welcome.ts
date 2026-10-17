const en = {
  "welcome.title": "Welcome",
  "welcome.heading": "Welcome, {name}",
  "welcome.waitingDescription":
    "Please wait a moment. The host will explain everything soon.",
  "welcome.nextDescription":
    "The next step is ready. Continue when you’re ready.",
  "welcome.previous": "Previous",
  "welcome.next": "Next",
  "welcome.finish": "Enter the app",
  "welcome.moving": "Loading…",
  "welcome.nextLocked": "The next step isn’t available yet.",
  "welcome.step": "Step {number}",
  "welcome.connectionLost": "We couldn’t check for updates.",
  "welcome.retry": "Try again",
  "welcome.signOut": "Sign out",
  "welcome.signingOut": "Signing out…",
  "welcome.opening": "Opening the app…",
  "welcome.profileLoading": "Loading your profile…",
  "adminWelcome.title": "Guest welcome",
  "adminWelcome.intro":
    "Unlock the steps one at a time. Guests move at their own pace and can go back.",
  "adminWelcome.required": "Required",
  "adminWelcome.requiredHint":
    "Every guest follows all the steps before entering, even if they arrive late.",
  "adminWelcome.requiredSaving": "Saving…",
  "adminWelcome.accessOpen": "App open",
  "adminWelcome.accessOpenDescription":
    "Guests can enter when they’re ready. If the welcome is required, they finish the steps first.",
  "adminWelcome.waiting": "Guests are waiting",
  "adminWelcome.waitingDescription":
    "Guests see the waiting screen. Unlock the first step when you’re ready.",
  "adminWelcome.currentStep": "Step {number} of {total} unlocked",
  "adminWelcome.allShown":
    "All steps are unlocked. Open the app when you’re ready.",
  "adminWelcome.stepsTitle": "Your steps",
  "adminWelcome.stepsHint":
    "Up to 12 steps. Saved changes also apply to guests already on the edited step.",
  "adminWelcome.empty":
    "Add the instructions you want to reveal one at a time.",
  "adminWelcome.add": "Add a step",
  "adminWelcome.selectStep": "Edit step {number}",
  "adminWelcome.drag": "Move step {number}",
  "adminWelcome.reorderHint":
    "Drag the handle, or use the selected step’s arrow buttons.",
  "adminWelcome.moved": "Step {from} moved to position {to}.",
  "adminWelcome.dragCancelled": "Move cancelled.",
  "adminWelcome.moveUp": "Move step {number} up",
  "adminWelcome.moveDown": "Move step {number} down",
  "adminWelcome.remove": "Remove step {number}",
  "adminWelcome.removeConfirmation":
    "Remove step {number}? Save your changes to confirm its removal.",
  "adminWelcome.save": "Save steps",
  "adminWelcome.saving": "Saving…",
  "adminWelcome.saved": "Steps saved.",
  "adminWelcome.unsaved": "Save your steps before continuing.",
  "adminWelcome.start": "Turn on the waiting screen",
  "adminWelcome.restart": "Restart the welcome",
  "adminWelcome.startConfirmation":
    "Move all guests to the waiting screen and restart the welcome from the beginning?",
  "adminWelcome.first": "Unlock the first step",
  "adminWelcome.next": "Unlock the next step",
  "adminWelcome.open": "Open the app",
  "adminWelcome.openConfirmation":
    "Open the app and unlock the remaining steps? Guests finish the welcome first if it is required.",
  "adminWelcome.updating": "Updating…",
  "adminWelcome.reload": "Refresh status",
  "adminWelcome.discard": "Discard changes",
  "adminWelcome.discardConfirmation":
    "Discard your changes to the steps? The latest saved version will be loaded.",
  "adminWelcome.discarded": "The latest saved steps have been loaded.",
  "adminWelcome.reloading": "Refreshing…",
  "adminWelcome.reloaded": "Status refreshed.",
  "adminWelcome.draftKept":
    "Status refreshed. Your unsaved steps are still in the form.",
};

type WelcomeMessages = Record<keyof typeof en, string>;

const fr: WelcomeMessages = {
  "welcome.title": "Bienvenue",
  "welcome.heading": "Bienvenue {name}",
  "welcome.waitingDescription":
    "Un peu de patience, l'organisateur va bientôt tout expliquer",
  "welcome.nextDescription":
    "La suite est disponible. Continue quand tu es prêt.",
  "welcome.previous": "Précédent",
  "welcome.next": "Suivant",
  "welcome.finish": "Entrer dans l’application",
  "welcome.moving": "Chargement…",
  "welcome.nextLocked": "La suite n’est pas encore disponible.",
  "welcome.step": "Étape {number}",
  "welcome.connectionLost": "Impossible de vérifier s’il y a du nouveau.",
  "welcome.retry": "Réessayer",
  "welcome.signOut": "Se déconnecter",
  "welcome.signingOut": "Déconnexion…",
  "welcome.opening": "Ouverture de l’application…",
  "welcome.profileLoading": "Chargement de ton profil…",
  "adminWelcome.title": "Accueil des invités",
  "adminWelcome.intro":
    "Débloque les étapes une à une. Chaque invité avance à son rythme et peut revenir en arrière.",
  "adminWelcome.required": "Obligatoire",
  "adminWelcome.requiredHint":
    "Chaque invité suit toutes les étapes avant d’entrer, même s’il arrive en retard.",
  "adminWelcome.requiredSaving": "Enregistrement…",
  "adminWelcome.accessOpen": "Application ouverte",
  "adminWelcome.accessOpenDescription":
    "Les invités peuvent entrer quand ils sont prêts. Si l’accueil est obligatoire, ils terminent d’abord les étapes.",
  "adminWelcome.waiting": "Les invités sont en attente",
  "adminWelcome.waitingDescription":
    "Les invités voient l’écran d’attente. Débloque la première étape quand tu es prêt.",
  "adminWelcome.currentStep": "Étape {number} sur {total} débloquée",
  "adminWelcome.allShown":
    "Toutes les étapes sont débloquées. Ouvre l’application quand tu es prêt.",
  "adminWelcome.stepsTitle": "Tes étapes",
  "adminWelcome.stepsHint":
    "Jusqu’à 12 étapes. Les changements enregistrés s’appliquent aussi aux invités déjà sur l’étape.",
  "adminWelcome.empty": "Ajoute les consignes que tu dévoileras une par une.",
  "adminWelcome.add": "Ajouter une étape",
  "adminWelcome.selectStep": "Modifier l’étape {number}",
  "adminWelcome.drag": "Déplacer l’étape {number}",
  "adminWelcome.reorderHint":
    "Fais glisser la poignée, ou utilise les flèches de l’étape sélectionnée.",
  "adminWelcome.moved": "Étape {from} déplacée en position {to}.",
  "adminWelcome.dragCancelled": "Déplacement annulé.",
  "adminWelcome.moveUp": "Monter l’étape {number}",
  "adminWelcome.moveDown": "Descendre l’étape {number}",
  "adminWelcome.remove": "Supprimer l’étape {number}",
  "adminWelcome.removeConfirmation":
    "Supprimer l’étape {number} ? Enregistre tes modifications pour confirmer sa suppression.",
  "adminWelcome.save": "Enregistrer les étapes",
  "adminWelcome.saving": "Enregistrement…",
  "adminWelcome.saved": "Les étapes sont enregistrées.",
  "adminWelcome.unsaved": "Enregistre les étapes avant de continuer.",
  "adminWelcome.start": "Activer l’écran d’attente",
  "adminWelcome.restart": "Relancer l’accueil",
  "adminWelcome.startConfirmation":
    "Placer tous les invités sur l’écran d’attente et reprendre le parcours depuis le début ?",
  "adminWelcome.first": "Débloquer la première étape",
  "adminWelcome.next": "Débloquer l’étape suivante",
  "adminWelcome.open": "Ouvrir l’application",
  "adminWelcome.openConfirmation":
    "Ouvrir l’application et débloquer les étapes restantes ? Les invités terminent d’abord le parcours si l’accueil est obligatoire.",
  "adminWelcome.updating": "Mise à jour…",
  "adminWelcome.reload": "Actualiser l’état",
  "adminWelcome.discard": "Abandonner les modifications",
  "adminWelcome.discardConfirmation":
    "Abandonner tes modifications des étapes ? La dernière version enregistrée sera chargée.",
  "adminWelcome.discarded": "La dernière version enregistrée a été chargée.",
  "adminWelcome.reloading": "Actualisation…",
  "adminWelcome.reloaded": "L’état a été actualisé.",
  "adminWelcome.draftKept":
    "L’état a été actualisé. Tes étapes non enregistrées sont toujours dans le formulaire.",
};

const de: WelcomeMessages = {
  "welcome.title": "Willkommen",
  "welcome.heading": "Willkommen, {name}",
  "welcome.waitingDescription":
    "Hab noch einen Moment Geduld. Der Gastgeber erklärt gleich alles.",
  "welcome.nextDescription":
    "Der nächste Schritt ist verfügbar. Mach weiter, wenn du bereit bist.",
  "welcome.previous": "Zurück",
  "welcome.next": "Weiter",
  "welcome.finish": "Zur App",
  "welcome.moving": "Wird geladen…",
  "welcome.nextLocked": "Der nächste Schritt ist noch nicht verfügbar.",
  "welcome.step": "Schritt {number}",
  "welcome.connectionLost": "Wir konnten nicht nach Neuigkeiten suchen.",
  "welcome.retry": "Erneut versuchen",
  "welcome.signOut": "Abmelden",
  "welcome.signingOut": "Abmeldung…",
  "welcome.opening": "Die App wird geöffnet…",
  "welcome.profileLoading": "Dein Profil wird geladen…",
  "adminWelcome.title": "Gäste empfangen",
  "adminWelcome.intro":
    "Gib die Schritte nacheinander frei. Jeder Gast geht im eigenen Tempo weiter und kann zurückgehen.",
  "adminWelcome.required": "Verpflichtend",
  "adminWelcome.requiredHint":
    "Jeder Gast durchläuft vor dem Eintritt alle Schritte, auch wenn er später dazukommt.",
  "adminWelcome.requiredSaving": "Wird gespeichert…",
  "adminWelcome.accessOpen": "App geöffnet",
  "adminWelcome.accessOpenDescription":
    "Gäste können eintreten, sobald sie bereit sind. Ist die Begrüßung verpflichtend, schließen sie zuerst die Schritte ab.",
  "adminWelcome.waiting": "Die Gäste warten",
  "adminWelcome.waitingDescription":
    "Die Gäste sehen den Wartebildschirm. Gib den ersten Schritt frei, sobald du bereit bist.",
  "adminWelcome.currentStep": "Schritt {number} von {total} freigegeben",
  "adminWelcome.allShown":
    "Alle Schritte sind freigegeben. Öffne die App, sobald du bereit bist.",
  "adminWelcome.stepsTitle": "Deine Schritte",
  "adminWelcome.stepsHint":
    "Bis zu 12 Schritte. Gespeicherte Änderungen sehen auch Gäste, die diesen Schritt gerade geöffnet haben.",
  "adminWelcome.empty":
    "Füge die Anweisungen hinzu, die du nacheinander zeigen möchtest.",
  "adminWelcome.add": "Schritt hinzufügen",
  "adminWelcome.selectStep": "Schritt {number} bearbeiten",
  "adminWelcome.drag": "Schritt {number} verschieben",
  "adminWelcome.reorderHint":
    "Ziehe den Griff oder nutze die Pfeile des ausgewählten Schritts.",
  "adminWelcome.moved": "Schritt {from} wurde an Position {to} verschoben.",
  "adminWelcome.dragCancelled": "Verschieben abgebrochen.",
  "adminWelcome.moveUp": "Schritt {number} nach oben verschieben",
  "adminWelcome.moveDown": "Schritt {number} nach unten verschieben",
  "adminWelcome.remove": "Schritt {number} entfernen",
  "adminWelcome.removeConfirmation":
    "Schritt {number} entfernen? Speichere deine Änderungen, um ihn zu entfernen.",
  "adminWelcome.save": "Schritte speichern",
  "adminWelcome.saving": "Wird gespeichert…",
  "adminWelcome.saved": "Schritte gespeichert.",
  "adminWelcome.unsaved": "Speichere deine Schritte, bevor du fortfährst.",
  "adminWelcome.start": "Wartebildschirm aktivieren",
  "adminWelcome.restart": "Begrüßung neu starten",
  "adminWelcome.startConfirmation":
    "Alle Gäste zum Wartebildschirm schicken und die Begrüßung von vorne beginnen?",
  "adminWelcome.first": "Ersten Schritt freigeben",
  "adminWelcome.next": "Nächsten Schritt freigeben",
  "adminWelcome.open": "App öffnen",
  "adminWelcome.openConfirmation":
    "Die App öffnen und die übrigen Schritte freigeben? Ist die Begrüßung verpflichtend, schließen die Gäste sie zuerst ab.",
  "adminWelcome.updating": "Wird aktualisiert…",
  "adminWelcome.reload": "Status aktualisieren",
  "adminWelcome.discard": "Änderungen verwerfen",
  "adminWelcome.discardConfirmation":
    "Deine Änderungen an den Schritten verwerfen? Die zuletzt gespeicherte Version wird geladen.",
  "adminWelcome.discarded":
    "Die zuletzt gespeicherten Schritte wurden geladen.",
  "adminWelcome.reloading": "Wird aktualisiert…",
  "adminWelcome.reloaded": "Status aktualisiert.",
  "adminWelcome.draftKept":
    "Status aktualisiert. Deine ungespeicherten Schritte stehen weiterhin im Formular.",
};

const it: WelcomeMessages = {
  "welcome.title": "Benvenuto",
  "welcome.heading": "Ti diamo il benvenuto, {name}",
  "welcome.waitingDescription":
    "Ancora un po’ di pazienza. Chi organizza spiegherà tutto tra poco.",
  "welcome.nextDescription":
    "Il prossimo passo è disponibile. Continua quando sei pronto.",
  "welcome.previous": "Indietro",
  "welcome.next": "Avanti",
  "welcome.finish": "Entra nell’app",
  "welcome.moving": "Caricamento…",
  "welcome.nextLocked": "Il prossimo passo non è ancora disponibile.",
  "welcome.step": "Passo {number}",
  "welcome.connectionLost":
    "Non siamo riusciti a controllare gli aggiornamenti.",
  "welcome.retry": "Riprova",
  "welcome.signOut": "Esci",
  "welcome.signingOut": "Uscita…",
  "welcome.opening": "Apertura dell’app…",
  "welcome.profileLoading": "Caricamento del tuo profilo…",
  "adminWelcome.title": "Accoglienza degli invitati",
  "adminWelcome.intro":
    "Sblocca i passi uno alla volta. Ogni invitato avanza al proprio ritmo e può tornare indietro.",
  "adminWelcome.required": "Obbligatorio",
  "adminWelcome.requiredHint":
    "Ogni invitato segue tutti i passi prima di entrare, anche se arriva in ritardo.",
  "adminWelcome.requiredSaving": "Salvataggio…",
  "adminWelcome.accessOpen": "App aperta",
  "adminWelcome.accessOpenDescription":
    "Gli invitati possono entrare quando sono pronti. Se l’accoglienza è obbligatoria, completano prima i passi.",
  "adminWelcome.waiting": "Gli invitati sono in attesa",
  "adminWelcome.waitingDescription":
    "Gli invitati vedono la schermata d’attesa. Sblocca il primo passo quando sei pronto.",
  "adminWelcome.currentStep": "Passo {number} di {total} sbloccato",
  "adminWelcome.allShown":
    "Tutti i passi sono sbloccati. Apri l’app quando sei pronto.",
  "adminWelcome.stepsTitle": "I tuoi passi",
  "adminWelcome.stepsHint":
    "Fino a 12 passi. Le modifiche salvate si applicano anche a chi sta già seguendo il passo.",
  "adminWelcome.empty":
    "Aggiungi le istruzioni che vuoi mostrare una alla volta.",
  "adminWelcome.add": "Aggiungi un passo",
  "adminWelcome.selectStep": "Modifica il passo {number}",
  "adminWelcome.drag": "Sposta il passo {number}",
  "adminWelcome.reorderHint":
    "Trascina la maniglia o usa le frecce del passo selezionato.",
  "adminWelcome.moved": "Passo {from} spostato in posizione {to}.",
  "adminWelcome.dragCancelled": "Spostamento annullato.",
  "adminWelcome.moveUp": "Sposta il passo {number} in alto",
  "adminWelcome.moveDown": "Sposta il passo {number} in basso",
  "adminWelcome.remove": "Rimuovi il passo {number}",
  "adminWelcome.removeConfirmation":
    "Rimuovere il passo {number}? Salva le modifiche per confermare la rimozione.",
  "adminWelcome.save": "Salva i passi",
  "adminWelcome.saving": "Salvataggio…",
  "adminWelcome.saved": "Passi salvati.",
  "adminWelcome.unsaved": "Salva i passi prima di continuare.",
  "adminWelcome.start": "Attiva la schermata d’attesa",
  "adminWelcome.restart": "Riavvia l’accoglienza",
  "adminWelcome.startConfirmation":
    "Portare tutti gli invitati alla schermata d’attesa e ricominciare l’accoglienza dall’inizio?",
  "adminWelcome.first": "Sblocca il primo passo",
  "adminWelcome.next": "Sblocca il prossimo passo",
  "adminWelcome.open": "Apri l’app",
  "adminWelcome.openConfirmation":
    "Aprire l’app e sbloccare i passi rimanenti? Se l’accoglienza è obbligatoria, gli invitati la completano prima di entrare.",
  "adminWelcome.updating": "Aggiornamento…",
  "adminWelcome.reload": "Aggiorna lo stato",
  "adminWelcome.discard": "Annulla le modifiche",
  "adminWelcome.discardConfirmation":
    "Annullare le modifiche ai passi? Verrà caricata l’ultima versione salvata.",
  "adminWelcome.discarded": "È stata caricata l’ultima versione salvata.",
  "adminWelcome.reloading": "Aggiornamento…",
  "adminWelcome.reloaded": "Stato aggiornato.",
  "adminWelcome.draftKept":
    "Stato aggiornato. I passi non salvati sono ancora nel modulo.",
};

const es: WelcomeMessages = {
  "welcome.title": "Bienvenida",
  "welcome.heading": "Te damos la bienvenida, {name}",
  "welcome.waitingDescription":
    "Un poco de paciencia. Quien organiza lo explicará todo enseguida.",
  "welcome.nextDescription":
    "El siguiente paso está disponible. Continúa cuando estés listo.",
  "welcome.previous": "Anterior",
  "welcome.next": "Siguiente",
  "welcome.finish": "Entrar en la aplicación",
  "welcome.moving": "Cargando…",
  "welcome.nextLocked": "El siguiente paso aún no está disponible.",
  "welcome.step": "Paso {number}",
  "welcome.connectionLost": "No hemos podido comprobar si hay novedades.",
  "welcome.retry": "Volver a intentar",
  "welcome.signOut": "Cerrar sesión",
  "welcome.signingOut": "Cerrando sesión…",
  "welcome.opening": "Abriendo la aplicación…",
  "welcome.profileLoading": "Cargando tu perfil…",
  "adminWelcome.title": "Recibir a los invitados",
  "adminWelcome.intro":
    "Desbloquea los pasos uno a uno. Cada invitado avanza a su ritmo y puede volver atrás.",
  "adminWelcome.required": "Obligatorio",
  "adminWelcome.requiredHint":
    "Cada invitado sigue todos los pasos antes de entrar, aunque llegue tarde.",
  "adminWelcome.requiredSaving": "Guardando…",
  "adminWelcome.accessOpen": "Aplicación abierta",
  "adminWelcome.accessOpenDescription":
    "Los invitados pueden entrar cuando estén listos. Si la bienvenida es obligatoria, primero completan los pasos.",
  "adminWelcome.waiting": "Los invitados están esperando",
  "adminWelcome.waitingDescription":
    "Los invitados ven la pantalla de espera. Desbloquea el primer paso cuando estés listo.",
  "adminWelcome.currentStep": "Paso {number} de {total} desbloqueado",
  "adminWelcome.allShown":
    "Todos los pasos están desbloqueados. Abre la aplicación cuando estés listo.",
  "adminWelcome.stepsTitle": "Tus pasos",
  "adminWelcome.stepsHint":
    "Hasta 12 pasos. Los cambios guardados también se muestran a quienes ya están en ese paso.",
  "adminWelcome.empty":
    "Añade las instrucciones que quieras mostrar una a una.",
  "adminWelcome.add": "Añadir un paso",
  "adminWelcome.selectStep": "Editar el paso {number}",
  "adminWelcome.drag": "Mover el paso {number}",
  "adminWelcome.reorderHint":
    "Arrastra el asa o usa las flechas del paso seleccionado.",
  "adminWelcome.moved": "Paso {from} movido a la posición {to}.",
  "adminWelcome.dragCancelled": "Movimiento cancelado.",
  "adminWelcome.moveUp": "Subir el paso {number}",
  "adminWelcome.moveDown": "Bajar el paso {number}",
  "adminWelcome.remove": "Eliminar el paso {number}",
  "adminWelcome.removeConfirmation":
    "¿Eliminar el paso {number}? Guarda los cambios para confirmar que quieres eliminarlo.",
  "adminWelcome.save": "Guardar los pasos",
  "adminWelcome.saving": "Guardando…",
  "adminWelcome.saved": "Pasos guardados.",
  "adminWelcome.unsaved": "Guarda los pasos antes de continuar.",
  "adminWelcome.start": "Activar la pantalla de espera",
  "adminWelcome.restart": "Reiniciar la bienvenida",
  "adminWelcome.startConfirmation":
    "¿Llevar a todos los invitados a la pantalla de espera y reiniciar la bienvenida desde el principio?",
  "adminWelcome.first": "Desbloquear el primer paso",
  "adminWelcome.next": "Desbloquear el siguiente paso",
  "adminWelcome.open": "Abrir la aplicación",
  "adminWelcome.openConfirmation":
    "¿Abrir la aplicación y desbloquear los pasos restantes? Si la bienvenida es obligatoria, los invitados la completan antes de entrar.",
  "adminWelcome.updating": "Actualizando…",
  "adminWelcome.reload": "Actualizar el estado",
  "adminWelcome.discard": "Descartar los cambios",
  "adminWelcome.discardConfirmation":
    "¿Descartar tus cambios en los pasos? Se cargará la última versión guardada.",
  "adminWelcome.discarded": "Se ha cargado la última versión guardada.",
  "adminWelcome.reloading": "Actualizando…",
  "adminWelcome.reloaded": "Estado actualizado.",
  "adminWelcome.draftKept":
    "Estado actualizado. Los pasos sin guardar siguen en el formulario.",
};

export const welcomeMessages = { en, fr, de, it, es };
