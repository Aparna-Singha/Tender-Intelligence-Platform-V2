"use client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
let csrfToken: string | null = null;

interface ErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
  readonly request_id?: unknown;
}

export class PublicApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicApiError(
      response.ok
        ? "The server returned an unreadable response. Please try again."
        : "The request could not be completed. Please try again.",
      response.status,
      "INVALID_RESPONSE",
      response.headers.get("x-request-id") ?? undefined,
    );
  }
}

function toPublicError(response: Response, body: unknown): PublicApiError {
  const envelope: ErrorEnvelope = isRecord(body) ? body : {};
  const error = isRecord(envelope.error) ? envelope.error : {};
  const code =
    typeof error.code === "string" ? error.code : `HTTP_${response.status}`;
  const message =
    typeof error.message === "string" && error.message.trim() !== ""
      ? error.message
      : response.status === 401
        ? "Your session has expired. Please log in again."
        : response.status === 403
          ? "You do not have permission to complete this action."
          : response.status >= 500
            ? "The service is temporarily unavailable. Please try again."
            : "The request could not be completed. Check your input and try again.";
  const requestId =
    typeof envelope.request_id === "string"
      ? envelope.request_id
      : (response.headers.get("x-request-id") ?? undefined);
  return new PublicApiError(message, response.status, code, requestId);
}

async function acquireCsrf(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/auth/csrf`, { credentials: "include" });
  } catch {
    throw new PublicApiError(
      "Unable to reach the service. Check your connection and try again.",
      0,
      "NETWORK_ERROR",
    );
  }
  const body = await parseResponse(response);
  if (
    !response.ok ||
    !isRecord(body) ||
    !isRecord(body.data) ||
    typeof body.data.csrf_token !== "string"
  ) {
    throw response.ok
      ? new PublicApiError(
          "The security token response was invalid. Please refresh and try again.",
          response.status,
          "INVALID_RESPONSE",
        )
      : toPublicError(response, body);
  }
  csrfToken = body.data.csrf_token;
  return csrfToken;
}

async function request<T>(
  path: string,
  init: RequestInit,
  allowCsrfRetry: boolean,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);
  if (!safeMethods.has(method)) {
    headers.set("x-csrf-token", csrfToken ?? (await acquireCsrf()));
    if (init.body !== undefined && !(init.body instanceof FormData))
      headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new PublicApiError(
      "Unable to reach the service. Check your connection and try again.",
      0,
      "NETWORK_ERROR",
    );
  }
  const body = await parseResponse(response);
  if (response.status === 403 && !safeMethods.has(method) && allowCsrfRetry) {
    csrfToken = null;
    return request<T>(path, init, false);
  }
  if (!response.ok) throw toPublicError(response, body);
  if (!isRecord(body) || !("data" in body)) {
    throw new PublicApiError(
      "The server returned an invalid response. Please try again.",
      response.status,
      "INVALID_RESPONSE",
      isRecord(body) && typeof body.request_id === "string"
        ? body.request_id
        : undefined,
    );
  }
  return body.data as T;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return request<T>(path, init, true);
}

export function formatApiError(error: unknown, fallback: string): string {
  if (!(error instanceof PublicApiError)) return fallback;
  return error.requestId === undefined
    ? error.message
    : `${error.message} Request ID: ${error.requestId}`;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}
