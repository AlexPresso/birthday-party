import { isImageType, isVideoType } from "../../lib/media-types.ts";
import type { UploadLimits } from "./contracts.ts";

export function uploadProblem(
  file: { type: string; size: number },
  limits: UploadLimits,
): "upload_type" | "upload_size" | "upload_video_size" | "upload_empty" | null {
  const video = isVideoType(file.type);
  if (!video && !isImageType(file.type)) return "upload_type";
  if (file.size > (video ? limits.videoBytes : limits.imageBytes))
    return video ? "upload_video_size" : "upload_size";
  if (file.size === 0) return "upload_empty";
  return null;
}
