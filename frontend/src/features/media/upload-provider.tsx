"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  errorMessage,
  responseError,
  returnToInvitation,
  returnToWelcome,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import { uploadProblem } from "./upload-validation";
import { createUploadPreviews } from "./upload-previews";
import {
  restoreUploadDismissals,
  storeUploadDismissals,
} from "./upload-dismissals";
import {
  uploadSchema,
  uploadsSchema,
  type UploadJob,
  type UploadLimits,
  type Photo,
} from "./contracts";

export type UploadDestination = {
  categoryId: number | null;
  welcomeRevision: number | null;
  welcomeWidgetIndex: number | null;
};

export type Transfer = UploadDestination & {
  clientUploadId: string;
  file: File;
  status: "queued" | "uploading" | "error";
  progress: number;
  error?: string;
  retryable: boolean;
};

type UploadContextValue = {
  transfers: Transfer[];
  jobs: UploadJob[];
  error: string | null;
  refresh: () => Promise<void>;
  addFiles: (
    files: File[],
    limits: UploadLimits,
    destination: UploadDestination,
  ) => boolean;
  retryTransfer: (id: string) => void;
  retryJob: (job: UploadJob) => void;
  canRetryJob: (job: UploadJob) => boolean;
  previewUrl: (id: string) => string | undefined;
  dismiss: (id: string) => void;
};

type CompletedUploads = {
  completed: Photo[];
  forgetPhoto: (id: number) => void;
};

// The queue changes with every progress step. Completed media sit in their own
// context so the gallery renders again only when a file becomes ready.
const UploadContext = createContext<UploadContextValue | null>(null);
const CompletedUploadsContext = createContext<CompletedUploads | null>(null);

function newUploadId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Local HTTP deployments can use getRandomValues without a secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function UploadProvider({
  children,
  welcomeRevision = null,
}: {
  children: ReactNode;
  welcomeRevision?: number | null;
}) {
  const { locale, t } = useI18n();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [completed, setCompleted] = useState<Photo[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const files = useRef(new Map<string, File>());
  const [previews] = useState(createUploadPreviews);
  const dismissed = useRef<string[]>([]);
  const mounted = useRef(true);
  const {
    connectionFailed,
    refresh: refreshQueue,
    retry: retryQueue,
  } = useRealtimeResource({
    topic: "uploads",
    restartKey: welcomeRevision,
    async read(signal) {
      const data = await api("/uploads", uploadsSchema, { signal });
      signal.throwIfAborted();
      const items =
        welcomeRevision === null
          ? data.items
          : data.items.filter((job) => job.welcomeRevision === welcomeRevision);
      const accepted = new Set(items.map((job) => job.clientUploadId));
      // The queue can confirm acceptance before the original HTTP response.
      // Keep its XHR alive, but show only the durable job, including failures.
      setTransfers((previous) =>
        previous.filter((item) => !accepted.has(item.clientUploadId)),
      );
      setJobs(items);
      setHidden(dismissed.current);
      rememberCompleted(items, true);
      setError(null);
      for (const job of data.items)
        if (job.status === "ready") files.current.delete(job.clientUploadId);
    },
    onError: (err) => setError(errorMessage(err, t)),
  });

  function rememberCompleted(items: UploadJob[], replace = false) {
    const ready = items.flatMap((job) =>
      job.status === "ready" && job.photo ? [job.photo] : [],
    );
    if (ready.length || replace) {
      setCompleted((previous) => {
        const candidates = [...(replace ? [] : previous), ...ready];
        const photosById = new Map(
          candidates.map((photo) => [photo.id, photo]),
        );
        const newestFirst = [...photosById.values()]
          .sort((a, b) => b.id - a.id)
          .slice(0, 150);
        const unchanged =
          newestFirst.length === previous.length &&
          newestFirst.every((photo, index) => photo.id === previous[index].id);
        return unchanged ? previous : newestFirst;
      });
    }
  }

  useEffect(() => {
    mounted.current = true;
    dismissed.current = restoreUploadDismissals();
    const active = requests.current;
    const retryFiles = files.current;
    return () => {
      mounted.current = false;
      active.forEach((request) => request.abort());
      retryFiles.clear();
      previews.clear();
    };
  }, [previews]);

  const transmitting = transfers.some((item) => item.status !== "error");
  useEffect(() => {
    if (!transmitting) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [transmitting]);

  // Layout ownership keeps file transfers alive when the guest changes tabs.
  useEffect(() => {
    const pending = transfers
      .filter(
        (item) =>
          item.status === "queued" &&
          !requests.current.has(item.clientUploadId),
      )
      .slice(0, Math.max(0, 2 - requests.current.size));
    for (const item of pending) {
      const request = new XMLHttpRequest();
      requests.current.set(item.clientUploadId, request);
      const update = (changes: Partial<Transfer>) => {
        if (mounted.current)
          setTransfers((items) =>
            items.map((entry) =>
              entry.clientUploadId === item.clientUploadId
                ? { ...entry, ...changes }
                : entry,
            ),
          );
      };
      update({ status: "uploading" });
      request.open(
        "POST",
        item.welcomeRevision === null && item.categoryId !== null
          ? `/api/photos?categoryId=${item.categoryId}`
          : "/api/photos",
      );
      request.setRequestHeader("X-Requested-With", "birthday-party");
      // The same key recovers an accepted upload if its response was lost.
      request.setRequestHeader("X-Upload-ID", item.clientUploadId);
      if (item.welcomeRevision !== null)
        request.setRequestHeader(
          "X-Welcome-Revision",
          String(item.welcomeRevision),
        );
      if (item.welcomeWidgetIndex !== null)
        request.setRequestHeader(
          "X-Welcome-Widget-Index",
          String(item.welcomeWidgetIndex),
        );
      request.timeout = 600000;
      let reported = 0;
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const progress = Math.round((event.loaded / event.total) * 100);
        // Browsers report progress far more often than the percentage changes.
        if (progress === reported) return;
        reported = progress;
        update({ progress });
      };
      request.onload = () => {
        requests.current.delete(item.clientUploadId);
        if (!mounted.current) return;
        try {
          const body: unknown = JSON.parse(request.responseText);
          if (request.status === 401) {
            returnToInvitation();
            return;
          }
          if (request.status === 423) {
            returnToWelcome();
            return;
          }
          if (request.status < 200 || request.status >= 300) {
            update({ status: "error", error: responseError(body, t) });
            return;
          }
          const job = uploadSchema.parse(body);
          rememberCompleted([job]);
          setTransfers((items) =>
            items.filter(
              (entry) => entry.clientUploadId !== item.clientUploadId,
            ),
          );
          setJobs((items) => [
            job,
            ...items.filter((entry) => entry.id !== job.id),
          ]);
          if (job.status === "ready") files.current.delete(job.clientUploadId);
          void refreshQueue();
        } catch (err) {
          update({ status: "error", error: errorMessage(err, t) });
        }
      };
      const fail = () => {
        requests.current.delete(item.clientUploadId);
        update({ status: "error", error: t("photos.interrupted") });
      };
      request.onerror = fail;
      request.ontimeout = fail;
      request.onabort = fail;
      const data = new FormData();
      data.append("file", item.file);
      request.send(data);
    }
  }, [transfers, t, refreshQueue]);

  function addFiles(
    selected: File[],
    limits: UploadLimits,
    destination: UploadDestination,
  ) {
    const active = jobs.filter(
      (job) => job.status === "queued" || job.status === "processing",
    ).length;
    const available = Math.max(0, 20 - transfers.length - active);
    const numbers = new Intl.NumberFormat(locale);
    const next = selected.slice(0, available).map((file): Transfer => {
      const problem = uploadProblem(file, limits);
      const clientUploadId = newUploadId();
      if (!problem) {
        files.current.set(clientUploadId, file);
        previews.remember(clientUploadId, file);
      }
      return {
        ...destination,
        clientUploadId,
        file,
        status: problem ? "error" : "queued",
        progress: 0,
        retryable: !problem,
        error: problem
          ? t(`errors.${problem}`, {
              size: numbers.format(
                (problem === "upload_video_size"
                  ? limits.videoBytes
                  : limits.imageBytes) /
                  (1024 * 1024),
              ),
            })
          : undefined,
      };
    });
    // Keep at most one selection's worth of originals for processing retries.
    while (files.current.size > 20) {
      const oldest = files.current.keys().next().value!;
      files.current.delete(oldest);
      previews.release(oldest);
    }
    setTransfers((items) => [...items, ...next]);
    return selected.length > available;
  }

  function dismiss(id: string) {
    const terminal = jobs.some(
      (job) =>
        job.clientUploadId === id &&
        (job.status === "ready" || job.status === "failed"),
    );
    if (requests.current.has(id) && !terminal) return;
    dismissed.current = [
      ...dismissed.current.filter((item) => item !== id),
      id,
    ].slice(-200);
    storeUploadDismissals(dismissed.current);
    setHidden(dismissed.current);
    files.current.delete(id);
    previews.release(id);
    setTransfers((items) => items.filter((item) => item.clientUploadId !== id));
    setJobs((items) => items.filter((job) => job.clientUploadId !== id));
  }
  function retryTransfer(id: string) {
    setTransfers((items) =>
      items.map((item) =>
        item.clientUploadId === id
          ? { ...item, status: "queued", progress: 0, error: undefined }
          : item,
      ),
    );
  }
  function retryJob(job: UploadJob) {
    const file = files.current.get(job.clientUploadId);
    if (!file || job.status !== "failed") return;
    const clientUploadId = newUploadId();
    files.current.set(clientUploadId, file);
    dismiss(job.clientUploadId);
    previews.remember(clientUploadId, file);
    setTransfers((items) => [
      ...items,
      {
        clientUploadId,
        file,
        categoryId: job.categoryId,
        welcomeRevision: job.welcomeRevision,
        welcomeWidgetIndex: job.welcomeWidgetIndex,
        status: "queued",
        progress: 0,
        retryable: true,
      },
    ]);
  }
  const forgetPhoto = useCallback((id: number) => {
    setCompleted((items) => items.filter((photo) => photo.id !== id));
    setJobs((items) =>
      items.map((job) =>
        job.status === "ready" && job.photo?.id === id
          ? { ...job, photo: null }
          : job,
      ),
    );
  }, []);
  const completedUploads = useMemo(
    () => ({ completed, forgetPhoto }),
    [completed, forgetPhoto],
  );
  return (
    <CompletedUploadsContext value={completedUploads}>
      <UploadContext
        value={{
          transfers,
          refresh: retryQueue,
          error:
            error ?? (connectionFailed ? t("common.connectionFailed") : null),
          addFiles,
          retryTransfer,
          retryJob,
          canRetryJob: (job) =>
            job.status === "failed" && files.current.has(job.clientUploadId),
          previewUrl: previews.get,
          dismiss,
          jobs: jobs.filter((job) => !hidden.includes(job.clientUploadId)),
        }}
      >
        {children}
      </UploadContext>
    </CompletedUploadsContext>
  );
}

/** The upload queue: it changes with every transfer progress step. */
export function useUploads() {
  const context = useContext(UploadContext);
  if (!context) throw new Error("UploadProvider is required.");
  return context;
}

/** Media that became ready in this session, unaffected by transfer progress. */
export function useCompletedUploads() {
  const context = useContext(CompletedUploadsContext);
  if (!context) throw new Error("UploadProvider is required.");
  return context;
}
