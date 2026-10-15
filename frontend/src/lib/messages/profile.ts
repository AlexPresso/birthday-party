const en = {
  "profile.photo": "Profile photo",
  "profile.formats": "JPEG, PNG or WebP, up to {size} MB.",
  "profile.choose": "Choose a photo",
  "profile.change": "Change photo",
  "profile.preview": "Profile photo preview",
  "profile.cropHint": "Your photo will be cropped around the centre.",
  "profile.save": "Save photo",
  "profile.saving": "Saving…",
  "profile.saved": "Profile photo saved.",
  "profile.cancel": "Cancel",
  "profile.remove": "Remove photo",
  "profile.removing": "Removing…",
  "profile.removed": "Profile photo removed.",
};

type ProfileMessages = Record<keyof typeof en, string>;

const fr: ProfileMessages = {
  "profile.photo": "Photo de profil",
  "profile.formats": "JPEG, PNG ou WebP, jusqu’à {size} Mo.",
  "profile.choose": "Choisir une photo",
  "profile.change": "Changer de photo",
  "profile.preview": "Aperçu de ta photo de profil",
  "profile.cropHint": "Ta photo sera recadrée autour du centre.",
  "profile.save": "Enregistrer la photo",
  "profile.saving": "Enregistrement…",
  "profile.saved": "Photo de profil enregistrée.",
  "profile.cancel": "Annuler",
  "profile.remove": "Supprimer la photo",
  "profile.removing": "Suppression…",
  "profile.removed": "Photo de profil supprimée.",
};

const de: ProfileMessages = {
  "profile.photo": "Profilfoto",
  "profile.formats": "JPEG, PNG oder WebP, bis zu {size} MB.",
  "profile.choose": "Foto auswählen",
  "profile.change": "Foto ändern",
  "profile.preview": "Vorschau deines Profilfotos",
  "profile.cropHint": "Dein Foto wird mittig zugeschnitten.",
  "profile.save": "Foto speichern",
  "profile.saving": "Wird gespeichert…",
  "profile.saved": "Profilfoto gespeichert.",
  "profile.cancel": "Abbrechen",
  "profile.remove": "Foto entfernen",
  "profile.removing": "Wird entfernt…",
  "profile.removed": "Profilfoto entfernt.",
};

const it: ProfileMessages = {
  "profile.photo": "Foto del profilo",
  "profile.formats": "JPEG, PNG o WebP, fino a {size} MB.",
  "profile.choose": "Scegli una foto",
  "profile.change": "Cambia foto",
  "profile.preview": "Anteprima della tua foto del profilo",
  "profile.cropHint": "La foto verrà ritagliata intorno al centro.",
  "profile.save": "Salva foto",
  "profile.saving": "Salvataggio…",
  "profile.saved": "Foto del profilo salvata.",
  "profile.cancel": "Annulla",
  "profile.remove": "Rimuovi foto",
  "profile.removing": "Rimozione…",
  "profile.removed": "Foto del profilo rimossa.",
};

const es: ProfileMessages = {
  "profile.photo": "Foto de perfil",
  "profile.formats": "JPEG, PNG o WebP, hasta {size} MB.",
  "profile.choose": "Elegir una foto",
  "profile.change": "Cambiar foto",
  "profile.preview": "Vista previa de tu foto de perfil",
  "profile.cropHint": "Tu foto se recortará alrededor del centro.",
  "profile.save": "Guardar foto",
  "profile.saving": "Guardando…",
  "profile.saved": "Foto de perfil guardada.",
  "profile.cancel": "Cancelar",
  "profile.remove": "Eliminar foto",
  "profile.removing": "Eliminando…",
  "profile.removed": "Foto de perfil eliminada.",
};

export const profileMessages = { en, fr, de, it, es };
