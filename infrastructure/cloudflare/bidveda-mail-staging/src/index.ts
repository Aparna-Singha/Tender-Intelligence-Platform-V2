const SENDER = "notifications@send.bidveda.space";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_BODY_BYTES = 4_096;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface Env {
  readonly RESEND_API_KEY: string;
  readonly EMAIL_ADAPTER_TOKEN: string;
  readonly ALLOWED_FRONTEND_ORIGIN: string;
}

type Template = "invitation" | "password_reset";

const TEMPLATES: Record<
  Template,
  {
    path: string;
    subject: string;
    heading: string;
    introduction: string;
    action: string;
    key: string;
  }
> = {
  invitation: {
    path: "/accept-invitation",
    subject: "You're invited to BidVeda",
    heading: "You're invited to BidVeda",
    introduction:
      "You've been invited to join a team on BidVeda. Use the link below to accept your invitation.",
    action: "Accept invitation",
    key: "invitation_url",
  },
  password_reset: {
    path: "/reset-password",
    subject: "Reset your BidVeda password",
    heading: "Reset your BidVeda password",
    introduction:
      "A password reset was requested for your BidVeda account. Use the link below to choose a new password.",
    action: "Reset password",
    key: "reset_url",
  },
};

function response(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

async function tokenMatches(
  header: string | null,
  expected: string,
): Promise<boolean> {
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length > 1_024) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualHash);
  const reference = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < reference.length; index += 1)
    difference |= actual[index]! ^ reference[index]!;
  return difference === 0 && provided.length > 0;
}

function frontendOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.href !== `${url.origin}/`
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validEmail(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    value.includes("\n") ||
    value.includes("\r")
  )
    return false;
  const parts = value.split("@");
  const local = parts[0];
  const domain = parts[1];
  if (
    parts.length !== 2 ||
    !local ||
    local.length > 64 ||
    !domain ||
    domain.length > 253
  )
    return false;
  if (
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  )
    return false;
  return (
    domain.split(".").length >= 2 &&
    domain
      .split(".")
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      )
  );
}

function validLink(
  value: unknown,
  origin: string,
  path: string,
): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === origin &&
      url.pathname === path &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.toString() === value &&
      [...url.searchParams.keys()].length === 1 &&
      TOKEN_PATTERN.test(url.searchParams.get("token") ?? "")
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

async function readBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  )
    return "TOO_LARGE";
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return "TOO_LARGE";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return null;
  }
}

export function createHandler(send: typeof fetch = fetch) {
  return async (request: Request, env: Env): Promise<Response> => {
    if (new URL(request.url).pathname !== "/deliver") return response(404);
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      });
    const origin = frontendOrigin(env.ALLOWED_FRONTEND_ORIGIN);
    if (!env.RESEND_API_KEY || !env.EMAIL_ADAPTER_TOKEN || origin === null)
      return response(503);
    if (
      !(await tokenMatches(
        request.headers.get("authorization"),
        env.EMAIL_ADAPTER_TOKEN,
      ))
    )
      return response(401);
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return response(415);
    let body: unknown;
    try {
      body = await readBody(request);
    } catch {
      return response(400);
    }
    if (body === "TOO_LARGE") return response(413);
    if (
      !record(body) ||
      !exactKeys(body, ["from", "template", "to", "variables"]) ||
      body.from !== SENDER ||
      !validEmail(body.to) ||
      (body.template !== "invitation" && body.template !== "password_reset") ||
      !record(body.variables)
    )
      return response(400);

    const template = TEMPLATES[body.template];
    if (!exactKeys(body.variables, [template.key])) return response(400);
    const link = body.variables[template.key];
    if (!validLink(link, origin, template.path)) return response(400);

    const safeLink = escapeHtml(link);
    const html = `<!doctype html><html><body><h1>${template.heading}</h1><p>${template.introduction}</p><p><a href="${safeLink}">${template.action}</a></p><p>If you did not expect this email, you can ignore it.</p><p>BidVeda</p></body></html>`;
    const text = `${template.heading}\n\n${template.introduction}\n\n${template.action}: ${link}\n\nIf you did not expect this email, you can ignore it.\n\nBidVeda`;
    try {
      const upstream = await send(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: SENDER,
          to: body.to,
          subject: template.subject,
          html,
          text,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      });
      if (!upstream.ok) return response(502);
      const receipt: unknown = await upstream.json();
      if (
        !record(receipt) ||
        typeof receipt.id !== "string" ||
        receipt.id.length === 0
      )
        return response(502);
      return response(204);
    } catch {
      return response(502);
    }
  };
}

export default { fetch: createHandler() };
