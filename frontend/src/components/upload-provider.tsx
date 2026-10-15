"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  api,
  errorMessage,
  responseError,
  returnToInvitation,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  uploadProblem,
  uploadSchema,
  uploadsSchema,
  type UploadJob,
  type UploadLimits,
  type Photo,
} from "@/lib/contracts";

type Transfer = {
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
  completed: Photo[];
  error: string | null;
  addFiles: (files: File[], limits: UploadLimits) => boolean;
  retryTransfer: (id: string) => void;
  retryJob: (job: UploadJob) => void;
  canRetryJob: (job: UploadJob) => boolean;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  forgetPhoto: (id: number) => void;
};

const UploadContext = createContext<UploadContextValue | null>(null);

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

export function UploadProvider({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [completed, setCompleted] = useState<Photo[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const files = useRef(new Map<string, File>());
  const mounted = useRef(true);

  function rememberCompleted(items: UploadJob[]) {
    const ready = items.flatMap((job) =>
      job.status === "ready" && job.photo ? [job.photo] : [],
    );
    if (ready.length)
      setCompleted((previous) =>
        [
          ...new Map(
            [...previous, ...ready].map((photo) => [photo.id, photo]),
          ).values(),
        ]
          .sort((a, b) => b.id - a.id)
          .slice(0, 150),
      );
  }

  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    return () => {
      mounted.current = false;
      active.forEach((request) => request.abort());
    };
  }, []);

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
      request.open("POST", "/api/photos");
      request.setRequestHeader("X-Requested-With", "birthday-party");
      // The same key recovers an accepted upload if its response was lost.
      request.setRequestHeader("X-Upload-ID", item.clientUploadId);
      request.timeout = 600000;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable)
          update({ progress: Math.round((event.loaded / event.total) * 100) });
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
          setRevision((value) => value + 1);
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
  }, [transfers, t]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function refresh() {
      clearTimeout(timer);
      if (running || document.hidden) return;
      running = true;
      try {
        const data = await api("/uploads", uploadsSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJobs(data.items);
        rememberCompleted(data.items);
        setError(null);
        for (const job of data.items)
          if (job.status === "ready") files.current.delete(job.clientUploadId);
        if (
          data.items.some(
            (job) => job.status === "queued" || job.status === "processing",
          )
        )
          timer = setTimeout(refresh, 3000);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(errorMessage(err, t));
          timer = setTimeout(refresh, 10000);
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revision, t]);

  function addFiles(selected: File[], limits: UploadLimits) {
    const active = jobs.filter(
      (job) => job.status === "queued" || job.status === "processing",
    ).length;
    const available = Math.max(0, 20 - transfers.length - active);
    const numbers = new Intl.NumberFormat(locale);
    const next = selected.slice(0, available).map((file): Transfer => {
      const problem = uploadProblem(file, limits);
      const clientUploadId = newUploadId();
      if (!problem) files.current.set(clientUploadId, file);
      return {
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
      files.current.delete(files.current.keys().next().value!);
    }
    setTransfers((items) => [...items, ...next]);
    return selected.length > available;
  }

  function dismiss(id: string) {
    if (requests.current.has(id)) return;
    setHidden((items) => [...items, id].slice(-200));
    files.current.delete(id);
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
    setTransfers((items) => [
      ...items,
      {
        clientUploadId,
        file,
        status: "queued",
        progress: 0,
        retryable: true,
      },
    ]);
  }
  function clearFinished() {
    transfers
      .filter((item) => item.status === "error")
      .forEach((item) => dismiss(item.clientUploadId));
    jobs
      .filter((job) => job.status === "ready" || job.status === "failed")
      .forEach((job) => dismiss(job.clientUploadId));
  }

  return (
    <UploadContext
      value={{
        transfers,
        error,
        addFiles,
        retryTransfer,
        retryJob,
        completed,
        canRetryJob: (job) =>
          job.status === "failed" && files.current.has(job.clientUploadId),
        dismiss,
        clearFinished,
        jobs: jobs.filter((job) => !hidden.includes(job.clientUploadId)),
        forgetPhoto: (id) => {
          setCompleted((items) => items.filter((photo) => photo.id !== id));
          setJobs((items) =>
            items.map((job) =>
              job.status === "ready" && job.photo?.id === id
                ? { ...job, photo: null }
                : job,
            ),
          );
        },
      }}
    >
      {children}
    </UploadContext>
  );
}

export function useUploads() {
  const context = useContext(UploadContext);
  if (!context) throw new Error("UploadProvider is required.");
  return context;
}

export function UploadNotice() {
  const pathname = usePathname();
  const { transfers, jobs } = useUploads();
  const { t } = useI18n();
  const active =
    transfers.some((item) => item.status !== "error") ||
    jobs.some((job) => job.status === "queued" || job.status === "processing");
  const failed =
    transfers.some((item) => item.status === "error") ||
    jobs.some((job) => job.status === "failed");
  if (pathname === "/photos" || (!active && !failed)) return null;
  return (
    <p className="upload-notice panel" role="status">
      <Link href="/photos">
        {t(active ? "photos.background" : "photos.needsAttention")}
      </Link>
    </p>
  );
}
