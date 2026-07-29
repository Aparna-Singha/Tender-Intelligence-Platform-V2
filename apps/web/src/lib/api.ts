"use client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
let csrfToken: string | null = null;

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (csrfToken === null) {
      const response = await fetch(`${apiUrl}/auth/csrf`, {
        credentials: "include",
      });
      const envelope = (await response.json()) as {
        data: { csrf_token: string };
      };
      csrfToken = envelope.data.csrf_token;
    }
    headers.set("x-csrf-token", csrfToken);
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = (await response.json()) as {
    data?: T;
    error?: { message: string };
  };
  if (!response.ok || body.data === undefined)
    throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}
