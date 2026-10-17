const en = {
  "widgets.palette": "Widgets",
  "widgets.paletteHint":
    "Drag a widget into the step, or add it with the + button.",
  "widgets.title": "Title",
  "widgets.text": "Text",
  "widgets.profilePhoto": "Profile photo",
  "widgets.mediaUpload": "Photos and videos",
  "widgets.add": "Add {name} widget",
  "widgets.dragNew": "Drag {name} widget into the step",
  "widgets.canvas": "Step widgets",
  "widgets.empty": "Add your first widget",
  "widgets.emptyHint":
    "Choose a title, text or something for your guests to do.",
  "widgets.count": "Widgets: {count}",
  "widgets.limit": "Up to 12 widgets per step.",
  "widgets.profileAdded": "Already in this step",
  "widgets.titleField": "Widget {number} title",
  "widgets.textField": "Widget {number} text",
  "widgets.drag": "Move widget {number}",
  "widgets.moveUp": "Move widget {number} up",
  "widgets.moveDown": "Move widget {number} down",
  "widgets.remove": "Remove widget {number}",
  "widgets.moved": "Widget {from} moved to position {to}.",
  "widgets.added": "{name} widget added at position {number}.",
  "widgets.removed": "Widget {number} removed.",
  "widgets.profileHint":
    "Guests can choose or change their profile photo here. No settings needed.",
  "widgets.invalidText":
    "Fill in each title and text. Titles allow 120 characters; texts allow 1000.",
  "widgets.emptyError": "Add at least one widget to each step.",
};

type WidgetMessages = Record<keyof typeof en, string>;

const fr: WidgetMessages = {
  "widgets.palette": "Widgets",
  "widgets.paletteHint":
    "Glisse un widget dans l’étape, ou ajoute-le avec le bouton +.",
  "widgets.title": "Titre",
  "widgets.text": "Texte",
  "widgets.profilePhoto": "Photo de profil",
  "widgets.mediaUpload": "Photos et vidéos",
  "widgets.add": "Ajouter le widget {name}",
  "widgets.dragNew": "Glisser le widget {name} dans l’étape",
  "widgets.canvas": "Widgets de l’étape",
  "widgets.empty": "Ajoute ton premier widget",
  "widgets.emptyHint":
    "Choisis un titre, du texte ou une action pour tes invités.",
  "widgets.count": "Widgets : {count}",
  "widgets.limit": "Jusqu’à 12 widgets par étape.",
  "widgets.profileAdded": "Déjà dans cette étape",
  "widgets.titleField": "Titre du widget {number}",
  "widgets.textField": "Texte du widget {number}",
  "widgets.drag": "Déplacer le widget {number}",
  "widgets.moveUp": "Monter le widget {number}",
  "widgets.moveDown": "Descendre le widget {number}",
  "widgets.remove": "Supprimer le widget {number}",
  "widgets.moved": "Widget {from} déplacé en position {to}.",
  "widgets.added": "Widget {name} ajouté en position {number}.",
  "widgets.removed": "Widget {number} supprimé.",
  "widgets.profileHint":
    "Les invités peuvent choisir ou changer leur photo de profil ici. Aucun réglage nécessaire.",
  "widgets.invalidText":
    "Remplis chaque titre et chaque texte. Les titres peuvent avoir 120 caractères, les textes 1000.",
  "widgets.emptyError": "Ajoute au moins un widget dans chaque étape.",
};

const de: WidgetMessages = {
  "widgets.palette": "Widgets",
  "widgets.paletteHint":
    "Ziehe ein Widget in den Schritt oder füge es mit + hinzu.",
  "widgets.title": "Titel",
  "widgets.text": "Text",
  "widgets.profilePhoto": "Profilfoto",
  "widgets.mediaUpload": "Fotos und Videos",
  "widgets.add": "Widget {name} hinzufügen",
  "widgets.dragNew": "Widget {name} in den Schritt ziehen",
  "widgets.canvas": "Widgets des Schritts",
  "widgets.empty": "Füge dein erstes Widget hinzu",
  "widgets.emptyHint":
    "Wähle einen Titel, Text oder eine Aktion für deine Gäste.",
  "widgets.count": "Widgets: {count}",
  "widgets.limit": "Bis zu 12 Widgets pro Schritt.",
  "widgets.profileAdded": "Bereits in diesem Schritt",
  "widgets.titleField": "Titel von Widget {number}",
  "widgets.textField": "Text von Widget {number}",
  "widgets.drag": "Widget {number} verschieben",
  "widgets.moveUp": "Widget {number} nach oben verschieben",
  "widgets.moveDown": "Widget {number} nach unten verschieben",
  "widgets.remove": "Widget {number} entfernen",
  "widgets.moved": "Widget {from} wurde an Position {to} verschoben.",
  "widgets.added": "Widget {name} wurde an Position {number} hinzugefügt.",
  "widgets.removed": "Widget {number} entfernt.",
  "widgets.profileHint":
    "Gäste können hier ihr Profilfoto auswählen oder ändern. Keine Einstellungen nötig.",
  "widgets.invalidText":
    "Fülle jeden Titel und Text aus. Titel dürfen 120 Zeichen haben, Texte 1000.",
  "widgets.emptyError": "Füge jedem Schritt mindestens ein Widget hinzu.",
};

const it: WidgetMessages = {
  "widgets.palette": "Widget",
  "widgets.paletteHint":
    "Trascina un widget nel passo o aggiungilo con il pulsante +.",
  "widgets.title": "Titolo",
  "widgets.text": "Testo",
  "widgets.profilePhoto": "Foto del profilo",
  "widgets.mediaUpload": "Foto e video",
  "widgets.add": "Aggiungi il widget {name}",
  "widgets.dragNew": "Trascina il widget {name} nel passo",
  "widgets.canvas": "Widget del passo",
  "widgets.empty": "Aggiungi il tuo primo widget",
  "widgets.emptyHint":
    "Scegli un titolo, del testo o un’azione per i tuoi invitati.",
  "widgets.count": "Widget: {count}",
  "widgets.limit": "Fino a 12 widget per passo.",
  "widgets.profileAdded": "Già in questo passo",
  "widgets.titleField": "Titolo del widget {number}",
  "widgets.textField": "Testo del widget {number}",
  "widgets.drag": "Sposta il widget {number}",
  "widgets.moveUp": "Sposta il widget {number} in alto",
  "widgets.moveDown": "Sposta il widget {number} in basso",
  "widgets.remove": "Rimuovi il widget {number}",
  "widgets.moved": "Widget {from} spostato in posizione {to}.",
  "widgets.added": "Widget {name} aggiunto in posizione {number}.",
  "widgets.removed": "Widget {number} rimosso.",
  "widgets.profileHint":
    "Gli invitati possono scegliere o cambiare la foto del profilo qui. Non servono impostazioni.",
  "widgets.invalidText":
    "Compila ogni titolo e testo. I titoli possono avere 120 caratteri, i testi 1000.",
  "widgets.emptyError": "Aggiungi almeno un widget in ogni passo.",
};

const es: WidgetMessages = {
  "widgets.palette": "Widgets",
  "widgets.paletteHint": "Arrastra un widget al paso o añádelo con el botón +.",
  "widgets.title": "Título",
  "widgets.text": "Texto",
  "widgets.profilePhoto": "Foto de perfil",
  "widgets.mediaUpload": "Fotos y vídeos",
  "widgets.add": "Añadir el widget {name}",
  "widgets.dragNew": "Arrastrar el widget {name} al paso",
  "widgets.canvas": "Widgets del paso",
  "widgets.empty": "Añade tu primer widget",
  "widgets.emptyHint":
    "Elige un título, texto o una acción para tus invitados.",
  "widgets.count": "Widgets: {count}",
  "widgets.limit": "Hasta 12 widgets por paso.",
  "widgets.profileAdded": "Ya está en este paso",
  "widgets.titleField": "Título del widget {number}",
  "widgets.textField": "Texto del widget {number}",
  "widgets.drag": "Mover el widget {number}",
  "widgets.moveUp": "Subir el widget {number}",
  "widgets.moveDown": "Bajar el widget {number}",
  "widgets.remove": "Eliminar el widget {number}",
  "widgets.moved": "Widget {from} movido a la posición {to}.",
  "widgets.added": "Widget {name} añadido en la posición {number}.",
  "widgets.removed": "Widget {number} eliminado.",
  "widgets.profileHint":
    "Los invitados pueden elegir o cambiar su foto de perfil aquí. No necesita ajustes.",
  "widgets.invalidText":
    "Completa cada título y texto. Los títulos admiten 120 caracteres y los textos 1000.",
  "widgets.emptyError": "Añade al menos un widget a cada paso.",
};

export const widgetMessages = { en, fr, de, it, es };
