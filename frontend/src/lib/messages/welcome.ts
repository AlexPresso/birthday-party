const en = {
  "welcome.title": "Welcome",
  "welcome.heading": "Welcome, {name}",
  "welcome.waitingDescription":
    "Please wait a moment. The host will explain everything soon.",
  "welcome.nextDescription":
    "The next step will appear here when the host is ready.",
  "welcome.step": "Step {number}",
  "welcome.connectionLost":
    "We couldn’t check for updates. We’ll try again automatically.",
  "welcome.retry": "Try again",
  "welcome.signOut": "Sign out",
  "welcome.signingOut": "Signing out…",
  "welcome.opening": "Opening the app…",
  "welcome.profileLoading": "Loading your profile…",
  "adminWelcome.title": "Guest welcome",
  "adminWelcome.intro":
    "Put guests on a waiting screen, then show your steps one at a time. You decide when to open the app.",
  "adminWelcome.accessOpen": "App open",
  "adminWelcome.accessOpenDescription": "Guests can use all four tabs.",
  "adminWelcome.waiting": "Guests are waiting",
  "adminWelcome.waitingDescription":
    "Guests see the waiting screen. Show the first step when you’re ready.",
  "adminWelcome.currentStep": "Step {number} of {total} is visible",
  "adminWelcome.allShown":
    "All steps have been shown. Open the app when you’re ready.",
  "adminWelcome.stepsTitle": "Your steps",
  "adminWelcome.stepsHint": "Up to 12 steps. Guests only see the current step.",
  "adminWelcome.empty":
    "Add the instructions you want to reveal one at a time.",
  "adminWelcome.add": "Add a step",
  "adminWelcome.stepTitle": "Step {number} title",
  "adminWelcome.stepBody": "Step {number} text",
  "adminWelcome.action": "Action",
  "adminWelcome.stepAction": "Step {number} action",
  "adminWelcome.noAction": "No action",
  "adminWelcome.profilePhotoAction": "Set a profile photo",
  "adminWelcome.selectStep": "Edit step {number}",
  "adminWelcome.untitled": "Untitled",
  "adminWelcome.drag": "Move step {number}",
  "adminWelcome.reorderHint":
    "Drag the handle, or use the selected step’s arrow buttons.",
  "adminWelcome.moved": "Step {from} moved to position {to}.",
  "adminWelcome.dragCancelled": "Move cancelled.",
  "adminWelcome.actionHint": "Add something guests can do during this step.",
  "adminWelcome.actionSettings": "Settings",
  "adminWelcome.noActionSettings": "No settings for this action.",
  "adminWelcome.removeAction": "Remove action",
  "adminWelcome.textOnly": "This step only shows your text.",
  "adminWelcome.moveUp": "Move step {number} up",
  "adminWelcome.moveDown": "Move step {number} down",
  "adminWelcome.remove": "Remove step {number}",
  "adminWelcome.removeConfirmation":
    "Remove step {number}? Save your changes to confirm its removal.",
  "adminWelcome.save": "Save steps",
  "adminWelcome.saving": "Saving…",
  "adminWelcome.saved": "Steps saved.",
  "adminWelcome.unsaved": "Save your steps before continuing.",
  "adminWelcome.draftLocked":
    "Your changes are still here. Open the app to save them.",
  "adminWelcome.locked":
    "Steps can be edited before the first reveal or once the app is open.",
  "adminWelcome.start": "Turn on the waiting screen",
  "adminWelcome.startConfirmation":
    "Move all guests to the waiting screen? They’ll regain access to the tabs when you open the app.",
  "adminWelcome.first": "Show the first step",
  "adminWelcome.next": "Show the next step",
  "adminWelcome.open": "Open the app",
  "adminWelcome.openConfirmation":
    "Open the app to all guests? They’ll have access to media, the programme and the guestbook.",
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
    "La suite s’affichera ici quand l’organisateur sera prêt.",
  "welcome.step": "Étape {number}",
  "welcome.connectionLost":
    "Impossible de vérifier s’il y a du nouveau. On réessaie automatiquement.",
  "welcome.retry": "Réessayer",
  "welcome.signOut": "Se déconnecter",
  "welcome.signingOut": "Déconnexion…",
  "welcome.opening": "Ouverture de l’application…",
  "welcome.profileLoading": "Chargement de ton profil…",
  "adminWelcome.title": "Accueil des invités",
  "adminWelcome.intro":
    "Place les invités sur un écran d’attente, puis affiche tes étapes une à une. Tu décides quand ouvrir l’application.",
  "adminWelcome.accessOpen": "Application ouverte",
  "adminWelcome.accessOpenDescription":
    "Les invités ont accès aux quatre onglets.",
  "adminWelcome.waiting": "Les invités sont en attente",
  "adminWelcome.waitingDescription":
    "Les invités voient l’écran d’attente. Affiche la première étape quand tu es prêt.",
  "adminWelcome.currentStep": "Étape {number} sur {total} affichée",
  "adminWelcome.allShown":
    "Toutes les étapes ont été affichées. Ouvre l’application quand tu es prêt.",
  "adminWelcome.stepsTitle": "Tes étapes",
  "adminWelcome.stepsHint":
    "Jusqu’à 12 étapes. Les invités voient uniquement l’étape en cours.",
  "adminWelcome.empty": "Ajoute les consignes que tu dévoileras une par une.",
  "adminWelcome.add": "Ajouter une étape",
  "adminWelcome.stepTitle": "Titre de l’étape {number}",
  "adminWelcome.stepBody": "Texte de l’étape {number}",
  "adminWelcome.action": "Action",
  "adminWelcome.stepAction": "Action de l’étape {number}",
  "adminWelcome.noAction": "Aucune action",
  "adminWelcome.profilePhotoAction": "Définir une photo de profil",
  "adminWelcome.selectStep": "Modifier l’étape {number}",
  "adminWelcome.untitled": "Sans titre",
  "adminWelcome.drag": "Déplacer l’étape {number}",
  "adminWelcome.reorderHint":
    "Fais glisser la poignée, ou utilise les flèches de l’étape sélectionnée.",
  "adminWelcome.moved": "Étape {from} déplacée en position {to}.",
  "adminWelcome.dragCancelled": "Déplacement annulé.",
  "adminWelcome.actionHint":
    "Ajoute une action pour les invités à cette étape.",
  "adminWelcome.actionSettings": "Réglages",
  "adminWelcome.noActionSettings": "Aucun réglage pour cette action.",
  "adminWelcome.removeAction": "Retirer l’action",
  "adminWelcome.textOnly": "Cette étape affiche seulement ton texte.",
  "adminWelcome.moveUp": "Monter l’étape {number}",
  "adminWelcome.moveDown": "Descendre l’étape {number}",
  "adminWelcome.remove": "Supprimer l’étape {number}",
  "adminWelcome.removeConfirmation":
    "Supprimer l’étape {number} ? Enregistre tes modifications pour confirmer sa suppression.",
  "adminWelcome.save": "Enregistrer les étapes",
  "adminWelcome.saving": "Enregistrement…",
  "adminWelcome.saved": "Les étapes sont enregistrées.",
  "adminWelcome.unsaved": "Enregistre les étapes avant de continuer.",
  "adminWelcome.draftLocked":
    "Tes modifications sont conservées. Ouvre l’application pour pouvoir les enregistrer.",
  "adminWelcome.locked":
    "Tu peux modifier les étapes avant le premier affichage ou une fois l’application ouverte.",
  "adminWelcome.start": "Activer l’écran d’attente",
  "adminWelcome.startConfirmation":
    "Placer tous les invités sur l’écran d’attente ? Ils retrouveront les onglets quand tu ouvriras l’application.",
  "adminWelcome.first": "Afficher la première étape",
  "adminWelcome.next": "Passer à l’étape suivante",
  "adminWelcome.open": "Ouvrir l’application",
  "adminWelcome.openConfirmation":
    "Ouvrir l’application à tous les invités ? Ils auront accès aux médias, au programme et au livre d’or.",
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
    "Der nächste Schritt erscheint hier, sobald der Gastgeber bereit ist.",
  "welcome.step": "Schritt {number}",
  "welcome.connectionLost":
    "Wir konnten nicht nach Neuigkeiten suchen. Wir versuchen es automatisch erneut.",
  "welcome.retry": "Erneut versuchen",
  "welcome.signOut": "Abmelden",
  "welcome.signingOut": "Abmeldung…",
  "welcome.opening": "Die App wird geöffnet…",
  "welcome.profileLoading": "Dein Profil wird geladen…",
  "adminWelcome.title": "Gäste empfangen",
  "adminWelcome.intro":
    "Lass deine Gäste auf einem Wartebildschirm warten und zeige deine Schritte nacheinander. Du entscheidest, wann du die App öffnest.",
  "adminWelcome.accessOpen": "App geöffnet",
  "adminWelcome.accessOpenDescription": "Gäste können alle vier Tabs nutzen.",
  "adminWelcome.waiting": "Die Gäste warten",
  "adminWelcome.waitingDescription":
    "Die Gäste sehen den Wartebildschirm. Zeige den ersten Schritt, sobald du bereit bist.",
  "adminWelcome.currentStep": "Schritt {number} von {total} ist sichtbar",
  "adminWelcome.allShown":
    "Alle Schritte wurden angezeigt. Öffne die App, sobald du bereit bist.",
  "adminWelcome.stepsTitle": "Deine Schritte",
  "adminWelcome.stepsHint":
    "Bis zu 12 Schritte. Gäste sehen nur den aktuellen Schritt.",
  "adminWelcome.empty":
    "Füge die Anweisungen hinzu, die du nacheinander zeigen möchtest.",
  "adminWelcome.add": "Schritt hinzufügen",
  "adminWelcome.stepTitle": "Titel von Schritt {number}",
  "adminWelcome.stepBody": "Text von Schritt {number}",
  "adminWelcome.action": "Aktion",
  "adminWelcome.stepAction": "Aktion für Schritt {number}",
  "adminWelcome.noAction": "Keine Aktion",
  "adminWelcome.profilePhotoAction": "Profilfoto auswählen",
  "adminWelcome.selectStep": "Schritt {number} bearbeiten",
  "adminWelcome.untitled": "Ohne Titel",
  "adminWelcome.drag": "Schritt {number} verschieben",
  "adminWelcome.reorderHint":
    "Ziehe den Griff oder nutze die Pfeile des ausgewählten Schritts.",
  "adminWelcome.moved": "Schritt {from} wurde an Position {to} verschoben.",
  "adminWelcome.dragCancelled": "Verschieben abgebrochen.",
  "adminWelcome.actionHint":
    "Füge eine Aktion für deine Gäste in diesem Schritt hinzu.",
  "adminWelcome.actionSettings": "Einstellungen",
  "adminWelcome.noActionSettings": "Diese Aktion hat keine Einstellungen.",
  "adminWelcome.removeAction": "Aktion entfernen",
  "adminWelcome.textOnly": "Dieser Schritt zeigt nur deinen Text.",
  "adminWelcome.moveUp": "Schritt {number} nach oben verschieben",
  "adminWelcome.moveDown": "Schritt {number} nach unten verschieben",
  "adminWelcome.remove": "Schritt {number} entfernen",
  "adminWelcome.removeConfirmation":
    "Schritt {number} entfernen? Speichere deine Änderungen, um ihn zu entfernen.",
  "adminWelcome.save": "Schritte speichern",
  "adminWelcome.saving": "Wird gespeichert…",
  "adminWelcome.saved": "Schritte gespeichert.",
  "adminWelcome.unsaved": "Speichere deine Schritte, bevor du fortfährst.",
  "adminWelcome.draftLocked":
    "Deine Änderungen sind noch da. Öffne die App, um sie zu speichern.",
  "adminWelcome.locked":
    "Du kannst die Schritte vor der ersten Freigabe oder nach dem Öffnen der App bearbeiten.",
  "adminWelcome.start": "Wartebildschirm aktivieren",
  "adminWelcome.startConfirmation":
    "Alle Gäste zum Wartebildschirm schicken? Sie erhalten wieder Zugang zu den Tabs, wenn du die App öffnest.",
  "adminWelcome.first": "Ersten Schritt zeigen",
  "adminWelcome.next": "Nächsten Schritt zeigen",
  "adminWelcome.open": "App öffnen",
  "adminWelcome.openConfirmation":
    "Die App für alle Gäste öffnen? Sie erhalten Zugang zu Medien, Programm und Gästebuch.",
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
    "Il prossimo passo apparirà qui quando chi organizza sarà pronto.",
  "welcome.step": "Passo {number}",
  "welcome.connectionLost":
    "Non siamo riusciti a controllare gli aggiornamenti. Riproveremo automaticamente.",
  "welcome.retry": "Riprova",
  "welcome.signOut": "Esci",
  "welcome.signingOut": "Uscita…",
  "welcome.opening": "Apertura dell’app…",
  "welcome.profileLoading": "Caricamento del tuo profilo…",
  "adminWelcome.title": "Accoglienza degli invitati",
  "adminWelcome.intro":
    "Metti gli invitati su una schermata d’attesa, poi mostra i tuoi passi uno alla volta. Decidi tu quando aprire l’app.",
  "adminWelcome.accessOpen": "App aperta",
  "adminWelcome.accessOpenDescription":
    "Gli invitati possono usare tutte e quattro le schede.",
  "adminWelcome.waiting": "Gli invitati sono in attesa",
  "adminWelcome.waitingDescription":
    "Gli invitati vedono la schermata d’attesa. Mostra il primo passo quando sei pronto.",
  "adminWelcome.currentStep": "Passo {number} di {total} visibile",
  "adminWelcome.allShown":
    "Tutti i passi sono stati mostrati. Apri l’app quando sei pronto.",
  "adminWelcome.stepsTitle": "I tuoi passi",
  "adminWelcome.stepsHint":
    "Fino a 12 passi. Gli invitati vedono solo quello attuale.",
  "adminWelcome.empty":
    "Aggiungi le istruzioni che vuoi mostrare una alla volta.",
  "adminWelcome.add": "Aggiungi un passo",
  "adminWelcome.stepTitle": "Titolo del passo {number}",
  "adminWelcome.stepBody": "Testo del passo {number}",
  "adminWelcome.action": "Azione",
  "adminWelcome.stepAction": "Azione del passo {number}",
  "adminWelcome.noAction": "Nessuna azione",
  "adminWelcome.profilePhotoAction": "Impostare una foto del profilo",
  "adminWelcome.selectStep": "Modifica il passo {number}",
  "adminWelcome.untitled": "Senza titolo",
  "adminWelcome.drag": "Sposta il passo {number}",
  "adminWelcome.reorderHint":
    "Trascina la maniglia o usa le frecce del passo selezionato.",
  "adminWelcome.moved": "Passo {from} spostato in posizione {to}.",
  "adminWelcome.dragCancelled": "Spostamento annullato.",
  "adminWelcome.actionHint":
    "Aggiungi un’azione per gli invitati in questo passo.",
  "adminWelcome.actionSettings": "Impostazioni",
  "adminWelcome.noActionSettings": "Questa azione non ha impostazioni.",
  "adminWelcome.removeAction": "Rimuovi azione",
  "adminWelcome.textOnly": "Questo passo mostra solo il tuo testo.",
  "adminWelcome.moveUp": "Sposta il passo {number} in alto",
  "adminWelcome.moveDown": "Sposta il passo {number} in basso",
  "adminWelcome.remove": "Rimuovi il passo {number}",
  "adminWelcome.removeConfirmation":
    "Rimuovere il passo {number}? Salva le modifiche per confermare la rimozione.",
  "adminWelcome.save": "Salva i passi",
  "adminWelcome.saving": "Salvataggio…",
  "adminWelcome.saved": "Passi salvati.",
  "adminWelcome.unsaved": "Salva i passi prima di continuare.",
  "adminWelcome.draftLocked":
    "Le tue modifiche sono ancora qui. Apri l’app per salvarle.",
  "adminWelcome.locked":
    "Puoi modificare i passi prima di mostrare il primo o dopo aver aperto l’app.",
  "adminWelcome.start": "Attiva la schermata d’attesa",
  "adminWelcome.startConfirmation":
    "Portare tutti gli invitati alla schermata d’attesa? Potranno tornare alle schede quando aprirai l’app.",
  "adminWelcome.first": "Mostra il primo passo",
  "adminWelcome.next": "Mostra il prossimo passo",
  "adminWelcome.open": "Apri l’app",
  "adminWelcome.openConfirmation":
    "Aprire l’app a tutti gli invitati? Avranno accesso ai media, al programma e al libro degli ospiti.",
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
    "El siguiente paso aparecerá aquí cuando quien organiza esté listo.",
  "welcome.step": "Paso {number}",
  "welcome.connectionLost":
    "No hemos podido comprobar si hay novedades. Lo intentaremos de nuevo automáticamente.",
  "welcome.retry": "Volver a intentar",
  "welcome.signOut": "Cerrar sesión",
  "welcome.signingOut": "Cerrando sesión…",
  "welcome.opening": "Abriendo la aplicación…",
  "welcome.profileLoading": "Cargando tu perfil…",
  "adminWelcome.title": "Recibir a los invitados",
  "adminWelcome.intro":
    "Lleva a los invitados a una pantalla de espera y muestra tus pasos uno a uno. Tú decides cuándo abrir la aplicación.",
  "adminWelcome.accessOpen": "Aplicación abierta",
  "adminWelcome.accessOpenDescription":
    "Los invitados pueden usar las cuatro pestañas.",
  "adminWelcome.waiting": "Los invitados están esperando",
  "adminWelcome.waitingDescription":
    "Los invitados ven la pantalla de espera. Muestra el primer paso cuando estés listo.",
  "adminWelcome.currentStep": "Paso {number} de {total} visible",
  "adminWelcome.allShown":
    "Ya se han mostrado todos los pasos. Abre la aplicación cuando estés listo.",
  "adminWelcome.stepsTitle": "Tus pasos",
  "adminWelcome.stepsHint":
    "Hasta 12 pasos. Los invitados solo ven el paso actual.",
  "adminWelcome.empty":
    "Añade las instrucciones que quieras mostrar una a una.",
  "adminWelcome.add": "Añadir un paso",
  "adminWelcome.stepTitle": "Título del paso {number}",
  "adminWelcome.stepBody": "Texto del paso {number}",
  "adminWelcome.action": "Acción",
  "adminWelcome.stepAction": "Acción del paso {number}",
  "adminWelcome.noAction": "Ninguna acción",
  "adminWelcome.profilePhotoAction": "Establecer una foto de perfil",
  "adminWelcome.selectStep": "Editar el paso {number}",
  "adminWelcome.untitled": "Sin título",
  "adminWelcome.drag": "Mover el paso {number}",
  "adminWelcome.reorderHint":
    "Arrastra el asa o usa las flechas del paso seleccionado.",
  "adminWelcome.moved": "Paso {from} movido a la posición {to}.",
  "adminWelcome.dragCancelled": "Movimiento cancelado.",
  "adminWelcome.actionHint":
    "Añade una acción para los invitados en este paso.",
  "adminWelcome.actionSettings": "Ajustes",
  "adminWelcome.noActionSettings": "Esta acción no tiene ajustes.",
  "adminWelcome.removeAction": "Quitar acción",
  "adminWelcome.textOnly": "Este paso solo muestra tu texto.",
  "adminWelcome.moveUp": "Subir el paso {number}",
  "adminWelcome.moveDown": "Bajar el paso {number}",
  "adminWelcome.remove": "Eliminar el paso {number}",
  "adminWelcome.removeConfirmation":
    "¿Eliminar el paso {number}? Guarda los cambios para confirmar que quieres eliminarlo.",
  "adminWelcome.save": "Guardar los pasos",
  "adminWelcome.saving": "Guardando…",
  "adminWelcome.saved": "Pasos guardados.",
  "adminWelcome.unsaved": "Guarda los pasos antes de continuar.",
  "adminWelcome.draftLocked":
    "Tus cambios siguen aquí. Abre la aplicación para guardarlos.",
  "adminWelcome.locked":
    "Puedes editar los pasos antes de mostrar el primero o después de abrir la aplicación.",
  "adminWelcome.start": "Activar la pantalla de espera",
  "adminWelcome.startConfirmation":
    "¿Llevar a todos los invitados a la pantalla de espera? Volverán a tener acceso a las pestañas cuando abras la aplicación.",
  "adminWelcome.first": "Mostrar el primer paso",
  "adminWelcome.next": "Mostrar el siguiente paso",
  "adminWelcome.open": "Abrir la aplicación",
  "adminWelcome.openConfirmation":
    "¿Abrir la aplicación a todos los invitados? Tendrán acceso a los medios, al programa y al libro de visitas.",
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
