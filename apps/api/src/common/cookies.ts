import { createHmac, timingSafeEqual } from "node:crypto";

import type { ApiEnvironment } from "@tender/config";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE_NAME = "tip_session";
export const CSRF_COOKIE_NAME = "tip_csrf";

function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined || header.length > 8_192) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length === 0 || value.length > 2_048) {
      continue;
    }
    cookies.set(name, value);
  }
  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    readonly httpOnly: boolean;
    readonly maxAgeSeconds: number;
    readonly secure: boolean;
  },
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`,
    "SameSite=Strict",
  ];
  if (options.httpOnly) {
    attributes.push("HttpOnly");
  }
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export class CookieService {
  public constructor(private readonly environment: ApiEnvironment) {}

  public readSession(request: FastifyRequest): string | null {
    return (
      parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null
    );
  }

  public setSession(reply: FastifyReply, token: string): void {
    reply.header(
      "set-cookie",
      serializeCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        maxAgeSeconds: this.environment.SESSION_TTL_SECONDS,
        secure: this.environment.SESSION_COOKIE_SECURE,
      }),
    );
  }

  public clearSession(reply: FastifyReply): void {
    reply.header(
      "set-cookie",
      serializeCookie(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        maxAgeSeconds: 0,
        secure: this.environment.SESSION_COOKIE_SECURE,
      }),
    );
  }

  public issueCsrf(reply: FastifyReply, token: string): void {
    const signature = this.sign(token);
    reply.header(
      "set-cookie",
      serializeCookie(CSRF_COOKIE_NAME, `${token}.${signature}`, {
        httpOnly: false,
        maxAgeSeconds: 3_600,
        secure: this.environment.SESSION_COOKIE_SECURE,
      }),
    );
  }

  public verifyCsrf(request: FastifyRequest, token: string): boolean {
    const signedCookie = parseCookies(request.headers.cookie).get(
      CSRF_COOKIE_NAME,
    );
    if (signedCookie === undefined) {
      return false;
    }
    const separator = signedCookie.lastIndexOf(".");
    if (separator <= 0) {
      return false;
    }
    const cookieToken = signedCookie.slice(0, separator);
    const suppliedSignature = signedCookie.slice(separator + 1);
    if (cookieToken !== token) {
      return false;
    }

    const expectedSignature = this.sign(cookieToken);
    const expected = Buffer.from(expectedSignature);
    const supplied = Buffer.from(suppliedSignature);
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  }

  private sign(value: string): string {
    return createHmac("sha256", this.environment.COOKIE_SECRET)
      .update(value)
      .digest("base64url");
  }
}
