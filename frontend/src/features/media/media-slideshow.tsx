"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { photosSchema, type PhotoPage } from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import "./media-slideshow.css";

type SlideshowError = {
  kind: "page" | "media" | "playback";
  message: string;
};

export function MediaSlideshow({
  initial,
  categoryId,
  categoryName,
  onClose,
}: {
  initial: PhotoPage;
  categoryId: number | null;
  categoryName: string;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState(() =>
    initial.items.filter((item) => item.categoryId === categoryId),
  );
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SlideshowError | null>(null);
  const [visit, setVisit] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pending = useRef<AbortController | null>(null);
  const current = items[index];
  const mediaKey = `${current?.id}:${visit}`;
  const active = playing && visible && !error && !loading;
  const numbers = new Intl.NumberFormat(locale);
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled;

  useEffect(() => {
    const player = video.current;
    if (!player || !current) return;
    // Restore the source if React replays this effect during development.
    if (!player.getAttribute("src")) {
      player.src = current.url;
      player.load();
    }
    return () => {
      player.pause();
      player.removeAttribute("src");
      player.load();
    };
  }, [mediaKey, current]);

  useEffect(() => {
    const modal = dialog.current!;
    const layout = frame.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();

    function visibilityChanged() {
      setVisible(!document.hidden);
    }
    function fullscreenChanged() {
      setFullscreen(document.fullscreenElement === layout);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      pending.current?.abort();
      pending.current = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      if (document.fullscreenElement === layout) {
        void document.exitFullscreen().catch(() => {});
      }
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const next = useCallback(async () => {
    if (pending.current || (items.length < 2 && !cursor)) return;
    setError(null);
    if (index < items.length - 1) {
      setVisit((value) => value + 1);
      setIndex(index + 1);
      return;
    }
    if (!cursor) {
      setVisit((value) => value + 1);
      setIndex(0);
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    pending.current = controller;
    setLoading(true);
    try {
      const page = await api(
        "/photos?limit=24&before=" +
          encodeURIComponent(cursor) +
          (categoryId === null ? "" : "&categoryId=" + categoryId),
        photosSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || pending.current !== controller) return;
      if (
        page.nextCursor === cursor ||
        page.items.some((item) => item.categoryId !== categoryId)
      ) {
        throw new ApiError("common.invalidResponse");
      }
      const additions = page.items.filter(
        (item) => !items.some((existing) => existing.id === item.id),
      );
      setItems([...items, ...additions]);
      setCursor(page.nextCursor);
      if (additions.length > 0) {
        setVisit((value) => value + 1);
        setIndex(items.length);
      } else if (!page.nextCursor) {
        setVisit((value) => value + 1);
        setIndex(0);
      }
    } catch (cause) {
      if (
        pending.current !== controller ||
        (controller.signal.aborted && !timedOut)
      )
        return;
      setPlaying(false);
      setError({
        kind: "page",
        message: errorMessage(
          timedOut ? new ApiError("common.connectionFailed") : cause,
          t,
        ),
      });
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted || timedOut) setLoading(false);
      }
    }
  }, [categoryId, cursor, index, items, t]);

  function previous() {
    if (pending.current || index === 0) return;
    setError(null);
    setVisit((value) => value + 1);
    setIndex(index - 1);
  }

  useEffect(() => {
    if (
      !active ||
      current?.kind !== "image" ||
      loadedKey !== mediaKey ||
      (items.length === 1 && !cursor)
    ) {
      return;
    }
    const timer = window.setTimeout(() => void next(), 5_000);
    return () => window.clearTimeout(timer);
  }, [active, current?.kind, cursor, items.length, loadedKey, mediaKey, next]);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let cancelled = false;
    if (active) {
      if (player.ended && (items.length > 1 || cursor)) {
        void next();
        return;
      }
      void player.play().catch((cause: unknown) => {
        if (
          cancelled ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        const mediaError =
          !!player.error ||
          (cause instanceof DOMException && cause.name === "NotSupportedError");
        setPlaying(false);
        setError({
          kind: mediaError ? "media" : "playback",
          message: t(
            mediaError ? "slideshow.mediaError" : "slideshow.playbackBlocked",
          ),
        });
      });
    } else {
      player.pause();
    }
    return () => {
      cancelled = true;
    };
  }, [active, cursor, items.length, mediaKey, next, t]);

  function mediaFailed() {
    setPlaying(false);
    setError({ kind: "media", message: t("slideshow.mediaError") });
  }

  function retry() {
    if (error?.kind === "page") {
      setPlaying(true);
      void next();
    } else {
      setError(null);
      setVisit((value) => value + 1);
      setPlaying(true);
    }
  }

  function togglePlayback() {
    if (error?.kind === "playback") {
      setError(null);
      setPlaying(true);
      // Keep this attempt inside the user's gesture for autoplay restrictions.
      // The playback effect reports any rejection after the state update.
      void video.current?.play().catch(() => {});
    } else {
      setPlaying((value) => !value);
    }
  }

  async function toggleFullscreen() {
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === frame.current) {
        await document.exitFullscreen();
      } else {
        await frame.current?.requestFullscreen();
      }
    } catch {
      setFullscreenError(true);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="media-slideshow"
      aria-label={t("slideshow.title")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open && dialog.current?.isConnected) onClose();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLVideoElement) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          void next();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          previous();
        }
      }}
    >
      <div ref={frame} className="slideshow-layout">
        <header className="slideshow-header">
          <div className="slideshow-heading">
            <p className="fine-print">{t("slideshow.title")}</p>
            <h2>{categoryName}</h2>
          </div>
          <div className="button-row">
            {fullscreenSupported && (
              <button
                className="icon-button"
                onClick={() => void toggleFullscreen()}
                aria-label={t(
                  fullscreen
                    ? "slideshow.exitFullscreen"
                    : "slideshow.fullscreen",
                )}
              >
                {fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}
              </button>
            )}
            <button
              autoFocus
              className="icon-button"
              onClick={onClose}
              aria-label={t("slideshow.close")}
            >
              <X />
            </button>
          </div>
        </header>
        <div
          className="slideshow-stage"
          aria-busy={loading || (!error && loadedKey !== mediaKey)}
        >
          {current?.kind === "video" ? (
            <video
              key={mediaKey}
              ref={video}
              className="slideshow-media"
              src={current.url}
              poster={current.thumbnailUrl}
              width={current.width}
              height={current.height}
              controls
              muted
              playsInline
              preload="auto"
              loop={items.length === 1 && !cursor}
              aria-label={t("photos.videoAlt", { name: current.author.name })}
              onLoadedData={() => setLoadedKey(mediaKey)}
              onError={mediaFailed}
              onEnded={() => {
                if (active) void next();
              }}
              onPlay={() => {
                if (document.hidden) video.current?.pause();
                else {
                  setPlaying(true);
                  setError((value) =>
                    value?.kind === "playback" ? null : value,
                  );
                }
              }}
              onPause={(event) => {
                if (
                  event.currentTarget === video.current &&
                  active &&
                  !document.hidden &&
                  event.currentTarget.paused &&
                  !event.currentTarget.ended
                ) {
                  setPlaying(false);
                }
              }}
            />
          ) : current ? (
            <img
              key={mediaKey}
              className="slideshow-media"
              src={current.url}
              width={current.width}
              height={current.height}
              alt={t("photos.alt", { name: current.author.name })}
              onLoad={() => setLoadedKey(mediaKey)}
              onError={mediaFailed}
            />
          ) : null}
          {(loading || (!error && loadedKey !== mediaKey)) && (
            <p className="slideshow-loading" role="status">
              {t("slideshow.loading")}
            </p>
          )}
        </div>
        {(error || fullscreenError) && (
          <div className="slideshow-notice">
            <p role="alert">
              {error?.message ?? t("slideshow.fullscreenError")}
            </p>
            {error && error.kind !== "playback" && (
              <button className="button secondary" onClick={retry}>
                <RotateCcw size={17} />
                {t("slideshow.retry")}
              </button>
            )}
          </div>
        )}
        <footer className="slideshow-footer">
          <span className="slideshow-author">{current?.author.name}</span>
          <div className="slideshow-navigation">
            <button
              className="icon-button"
              disabled={loading || index === 0}
              onClick={previous}
              aria-label={t("photos.previous")}
            >
              <ChevronLeft />
            </button>
            <button
              className="button primary slideshow-play"
              disabled={!!error && error.kind !== "playback"}
              onClick={togglePlayback}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {t(playing ? "slideshow.pause" : "slideshow.resume")}
            </button>
            <button
              className="icon-button"
              disabled={loading || (items.length < 2 && !cursor)}
              onClick={() => void next()}
              aria-label={t("photos.next")}
            >
              <ChevronRight />
            </button>
          </div>
          <span className="slideshow-count fine-print">
            {numbers.format(index + 1)} / {numbers.format(items.length)}
            {cursor ? "+" : ""}
          </span>
        </footer>
      </div>
    </dialog>
  );
}
