import type { UploadJob } from "./contracts.ts";
import type { Transfer } from "./upload-provider.tsx";

export function uploadProgress(
  transfers: readonly Transfer[],
  jobs: readonly UploadJob[],
) {
  const acceptedIds = new Set(jobs.map((job) => job.clientUploadId));
  // Realtime can confirm acceptance before the upload request returns.
  const pendingTransfers = transfers.filter(
    (transfer) => !acceptedIds.has(transfer.clientUploadId),
  );
  const sent = acceptedIds.size;
  const total = sent + pendingTransfers.length;
  let transferred = sent;
  for (const transfer of pendingTransfers) {
    if (transfer.status === "uploading") {
      // Sending the last byte does not confirm that the server accepted it.
      transferred += Math.min(99, Math.max(0, transfer.progress)) / 100;
    }
  }
  return {
    pendingTransfers,
    sent,
    total,
    percent: total === 0 ? 0 : (transferred / total) * 100,
  };
}
