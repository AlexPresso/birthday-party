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

export async function readResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(responseCode(body), response.status);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("common.invalidResponse");
  return parsed.data;
}

async function fetchResponse(path: string, options: RequestInit) {
  try {
    return await fetch(path, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError("common.connectionFailed");
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
) {
  const body = options?.body;
  const multipart = body instanceof FormData;
  const response = await fetchResponse(`/api${path}`, {
    method: options?.method || "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options?.signal,
    headers: {
      "X-Requested-With": "birthday-party",
      ...(options?.body !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: multipart
      ? body
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
  });
  if (response.status === 401 && !path.startsWith("/invitations"))
    returnToInvitation();
  if (response.status === 423) returnToWelcome();
  return readResponse(response, schema);
}

export async function remove(
  path: string,
  method = "DELETE",
  options?: { body?: unknown; signal?: AbortSignal },
) {
  const response = await fetchResponse(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal: options?.signal,
    headers: {
      "X-Requested-With": "birthday-party",
      ...(options?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401) returnToInvitation();
  if (response.status === 423) returnToWelcome();
  if (!response.ok)
    throw new ApiError(
      responseCode(await response.json().catch(() => null)),
      response.status,
    );
}

export function errorMessage(error: unknown, t: Translator) {
  if (error instanceof ApiError) return t(error.code as MessageKey);
  // Explicit form-validation errors already contain translated interface copy.
  if (error instanceof Error && error.name === "Error") return error.message;
  return t("common.actionFailed");
}
