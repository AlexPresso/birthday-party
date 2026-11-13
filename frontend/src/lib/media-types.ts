// Formats the browser offers for upload. Go validates the actual file content;
// these lists only drive file selection, local previews and early feedback.
export const imageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const videoMimeTypes = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export const isImageType = (type: string) =>
  (imageMimeTypes as readonly string[]).includes(type);

export const isVideoType = (type: string) =>
  (videoMimeTypes as readonly string[]).includes(type);

export const imageAccept = imageMimeTypes.join(",");

// Extensions cover devices that report videos without a usable MIME type.
export const mediaAccept = [
  ...imageMimeTypes,
  ...videoMimeTypes,
  ".mp4",
  ".mov",
  ".webm",
].join(",");
