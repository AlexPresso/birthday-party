const storageKey = "birthday-party:dismissed-uploads";
const uploadId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function validIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is string => typeof id === "string" && uploadId.test(id),
  );
  return [...new Set(ids)].slice(-200);
}

export function restoreUploadDismissals(
  storage?: Pick<Storage, "getItem">,
): string[] {
  try {
    const raw = (storage ?? window.sessionStorage).getItem(storageKey);
    // Our bounded list fits within 8 KiB; do not parse larger stored input.
    if (!raw || raw.length > 8192) return [];
    return validIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function storeUploadDismissals(
  ids: string[],
  storage?: Pick<Storage, "setItem">,
) {
  try {
    (storage ?? window.sessionStorage).setItem(
      storageKey,
      JSON.stringify(validIds(ids)),
    );
  } catch {
    // Dismissal still works for this mounted provider when storage is unavailable.
  }
}
