/** Server-only transport to the Access-protected API. User authority stays in NestJS. */
export interface ApiProxyEnvironment {
  readonly API_PROXY_ORIGIN?: string | undefined;
  readonly CF_ACCESS_CLIENT_ID?: string | undefined;
  readonly CF_ACCESS_CLIENT_SECRET?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

const REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "origin",
  "range",
  "x-csrf-token",
  "x-request-id",
] as const;

const RESPONSE_HEADERS = [
  "accept-ranges",
  "content-disposition",
  "content-range",
  "content-type",
  "last-modified",
  "retry-after",
  "x-request-id",
  "x-csrf-token",
] as const;

function failure(status: number): Response {
  return Response.json(
    {
      error: {
        code: "API_PROXY_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function validatedOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.origin === value &&
      parsed.username === "" &&
      parsed.password === ""
      ? value
      : null;
  } catch {
    return null;
  }
}

function upstreamUrl(request: Request, origin: string): URL | null {
  let incoming: URL;
  try {
    incoming = new URL(request.url);
  } catch {
    return null;
  }
  if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/"))
    return null;
  const path = incoming.pathname.slice(4) || "/";
  if (path.includes("\\") || path.includes("//") || /%(?:2f|5c|00)/i.test(path))
    return null;
  const target = new URL(origin);
  target.pathname = path;
  target.search = incoming.search;
  return target.origin === origin ? target : null;
}

function allowedCookies(value: string | null): string | null {
  if (value === null || value.length > 8_192) return null;
  const session = /^[A-Za-z0-9_-]{43}$/;
  const csrf = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
  const cookies = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return false;
      const name = part.slice(0, separator);
      const token = part.slice(separator + 1);
      return name === "tip_session"
        ? session.test(token)
        : name === "tip_csrf" && csrf.test(token);
    });
  return cookies.length === 0 ? null : cookies.join("; ");
}

function safeSetCookie(value: string, production: boolean): boolean {
  const parts = value.split(";").map((part) => part.trim());
  const name = parts[0]?.slice(0, parts[0].indexOf("="));
  if (name !== "tip_session" && name !== "tip_csrf") return false;
  const attributes = parts.slice(1).map((part) => part.toLowerCase());
  return (
    attributes.includes("path=/") &&
    attributes.includes("samesite=strict") &&
    !attributes.some((part) => part.startsWith("domain=")) &&
    (!production || attributes.includes("secure")) &&
    (name !== "tip_session" || attributes.includes("httponly"))
  );
}

export async function proxyApiRequest(
  request: Request,
  environment: ApiProxyEnvironment,
  send: typeof fetch = fetch,
): Promise<Response> {
  const origin = validatedOrigin(environment.API_PROXY_ORIGIN);
  const clientId = environment.CF_ACCESS_CLIENT_ID;
  const clientSecret = environment.CF_ACCESS_CLIENT_SECRET;
  if (origin === null || !clientId || !clientSecret) return failure(503);
  const target = upstreamUrl(request, origin);
  if (target === null) return failure(400);

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const cookies = allowedCookies(request.headers.get("cookie"));
  if (cookies !== null) headers.set("cookie", cookies);
  headers.set("CF-Access-Client-Id", clientId);
  headers.set("CF-Access-Client-Secret", clientSecret);

  const body =
    request.method === "GET" || request.method === "HEAD" ? null : request.body;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
    signal: request.signal,
  };
  if (body !== null) init.duplex = "half";

  let upstream: Response;
  try {
    upstream = await send(target, init);
  } catch {
    return failure(502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel().catch(() => undefined);
    return failure(502);
  }
  if (
    upstream.headers.get("content-type")?.toLowerCase().startsWith("text/html")
  ) {
    await upstream.body?.cancel().catch(() => undefined);
    return failure(502);
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie())
    if (safeSetCookie(cookie, environment.NODE_ENV === "production"))
      responseHeaders.append("Set-Cookie", cookie);
  const noBody =
    request.method === "HEAD" ||
    upstream.status === 204 ||
    upstream.status === 304;
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
