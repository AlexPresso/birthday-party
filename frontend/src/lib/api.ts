import type { z } from "zod";
import type { MessageKey, Translator } from "./i18n";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function returnToInvitation() {
  // A full navigation discards private data in the client router cache after
  // logout or session expiry. Client-side routing would retain that cache.
  window.location.replace("/invitation");
}

export function returnToWelcome() {
  // Discard previously visited private routes when the host closes guest access.
  window.location.replace("/attente");
}

function responseCode(body: unknown): string {
  return body &&
    typeof body === "object" &&
    "code" in body &&
    typeof body.code === "string" &&
    /^[a-z_]+$/.test(body.code)
    ? `errors.${body.code}`
    : "common.actionFailed";
}

export function responseError(body: unknown, t: Translator) {
  return t(responseCode(body) as MessageKey);
}

function parseResponse<T>(
  response: Response,
  body: unknown,
  schema: z.ZodType<T>,
): T {
  if (!response.ok) throw new ApiError(responseCode(body), response.status);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("common.invalidResponse");
  return parsed.data;
}

export async function readResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  return parseResponse(response, body, schema);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** The caller's own cancellation: it rejects with the abort, not an ApiError. */
  signal?: AbortSignal;
  /**
   * Milliseconds before the request fails as a connection error; 0 disables.
   * Multipart uploads have no default because their duration follows the file.
   */
  timeout?: number;
};

const defaultTimeout = 15_000;

function anySignal(signals: AbortSignal[]) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  // Safari before 17.4: forward the first abort by hand.
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      signal: controller.signal,
    });
  }
  return controller.signal;
}

/** Sends one browser request and reads its JSON body within the deadline. */
async function send(path: string, options: RequestOptions = {}) {
  const { body, signal: cancellation } = options;
  const multipart = body instanceof FormData;
  const timeout = options.timeout ?? (multipart ? 0 : defaultTimeout);
  const deadline = new AbortController();
  const timer =
    timeout > 0 ? setTimeout(() => deadline.abort(), timeout) : undefined;
  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: cancellation
        ? anySignal([cancellation, deadline.signal])
        : deadline.signal,
      headers: {
        "X-Requested-With": "birthday-party",
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: multipart
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
    });
    // A connection can also stall after the headers, while the body arrives.
    const payload: unknown = await response.json().catch(() => null);
    cancellation?.throwIfAborted();
    if (deadline.signal.aborted) throw new ApiError("common.connectionFailed");
    if (response.status === 401 && !path.startsWith("/invitations"))
      returnToInvitation();
    if (response.status === 423) returnToWelcome();
    return { response, payload };
  } catch (error) {
    // Only the caller's cancellation stays an abort. The deadline and network
    // failures both mean the request did not get through.
    if (cancellation?.aborted || error instanceof ApiError) throw error;
    throw new ApiError("common.connectionFailed");
  } finally {
    clearTimeout(timer);
    // Also detaches the hand-forwarded listeners from the caller's signal.
    deadline.abort();
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestOptions,
) {
  const { response, payload } = await send(path, options);
  return parseResponse(response, payload, schema);
}

/** Sends a request whose successful response has no body to validate. */
export async function remove(
  path: string,
  method = "DELETE",
  options?: Omit<RequestOptions, "method">,
) {
  const { response, payload } = await send(path, { ...options, method });
  if (!response.ok) throw new ApiError(responseCode(payload), response.status);
}

export function errorMessage(error: unknown, t: Translator) {
  if (error instanceof ApiError) return t(error.code as MessageKey);
  // Explicit form-validation errors already contain translated interface copy.
  if (error instanceof Error && error.name === "Error") return error.message;
  return t("common.actionFailed");
}
