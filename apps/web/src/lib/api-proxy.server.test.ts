import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { proxyApiRequest } from "./api-proxy.server";

const environment = {
  API_PROXY_ORIGIN: "https://api-staging.bidveda.space",
  CF_ACCESS_CLIENT_ID: "server-client-id",
  CF_ACCESS_CLIENT_SECRET: "server-client-secret",
  NODE_ENV: "production",
};
const sessionCookie = "A".repeat(43);
const csrfCookie = `${"B".repeat(43)}.${"C".repeat(43)}`;

function accepted(
  response: Response = Response.json({ data: "ok" }),
): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

afterEach(() => vi.restoreAllMocks());

describe("Access-protected API proxy", () => {
  it("keeps the upstream fixed and replaces browser-supplied Access credentials", async () => {
    const send = accepted();
    const request = new Request(
      "https://web.bidveda.space/api/auth/session?view=full&x=1",
      {
        headers: {
          "CF-Access-Client-Id": "browser-id",
          "CF-Access-Client-Secret": "browser-secret",
          "CF-Access-Jwt-Assertion": "browser-jwt",
          Authorization: "Bearer browser-token",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-For": "10.0.0.1",
          Forwarded: "for=10.0.0.1",
          Host: "evil.example",
          Connection: "keep-alive",
          Cookie: `tip_session=${sessionCookie}; CF_Authorization=access-cookie; tip_csrf=${csrfCookie}; other=private`,
          Origin: "https://web.bidveda.space",
          "X-Request-Id": "request-123",
        },
      },
    );
    const result = await proxyApiRequest(request, environment, send);
    expect(result.status).toBe(200);
    const [target, init] = send.mock.calls[0]!;
    expect((target as URL).href).toBe(
      "https://api-staging.bidveda.space/auth/session?view=full&x=1",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("cf-access-client-id")).toBe(
      environment.CF_ACCESS_CLIENT_ID,
    );
    expect(headers.get("cf-access-client-secret")).toBe(
      environment.CF_ACCESS_CLIENT_SECRET,
    );
    expect(headers.get("cf-access-jwt-assertion")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("forwarded")).toBeNull();
    expect(headers.get("host")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("cookie")).toBe(
      `tip_session=${sessionCookie}; tip_csrf=${csrfCookie}`,
    );
    expect(headers.get("origin")).toBe("https://web.bidveda.space");
    expect(headers.get("x-request-id")).toBe("request-123");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("drops malformed application cookies that embed Access credentials", async () => {
    const send = accepted();
    await proxyApiRequest(
      new Request("https://web.bidveda.space/api/auth/session", {
        headers: {
          Cookie: `tip_session=${sessionCookie},CF_Authorization=stolen; tip_csrf=${csrfCookie}`,
        },
      }),
      environment,
      send,
    );
    expect(new Headers(send.mock.calls[0]![1]?.headers).get("cookie")).toBe(
      `tip_csrf=${csrfCookie}`,
    );
  });

  it("preserves session and CSRF cookies without exposing Access cookies or internal headers", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      "x-request-id": "upstream-request",
      "cf-access-jwt-assertion": "upstream-secret",
      "access-control-allow-origin": "*",
      "content-security-policy": "internal-policy",
    });
    headers.append(
      "set-cookie",
      "tip_session=abc; Path=/; SameSite=Strict; HttpOnly; Secure",
    );
    headers.append(
      "set-cookie",
      "tip_csrf=def; Path=/; SameSite=Strict; Secure",
    );
    headers.append("set-cookie", "CF_Authorization=access; Path=/; Secure");
    headers.append(
      "set-cookie",
      "tip_session=unsafe; Domain=api-staging.bidveda.space; Path=/; SameSite=Strict; HttpOnly; Secure",
    );
    const send = accepted(new Response('{"data":{}}', { headers }));
    const result = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/auth/login"),
      environment,
      send,
    );
    expect(result.headers.getSetCookie()).toEqual([
      "tip_session=abc; Path=/; SameSite=Strict; HttpOnly; Secure",
      "tip_csrf=def; Path=/; SameSite=Strict; Secure",
    ]);
    expect(result.headers.get("cf-access-jwt-assertion")).toBeNull();
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(result.headers.get("content-security-policy")).toBeNull();
    expect(result.headers.get("x-request-id")).toBe("upstream-request");
  });

  it("forwards CSRF, JSON, and request bodies without consuming them", async () => {
    const send = accepted();
    const request = new Request("https://web.bidveda.space/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://web.bidveda.space",
        "X-Csrf-Token": "csrf-token",
      },
      body: JSON.stringify({ all: true }),
    });
    await proxyApiRequest(request, environment, send);
    const init = send.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
    expect(headers.get("origin")).toBe("https://web.bidveda.space");
    expect(headers.get("content-type")).toBe("application/json");
    expect(init.body).toBe(request.body);
    expect((init as RequestInit & { duplex?: string }).duplex).toBe("half");
    expect(await new Response(init.body).text()).toBe('{"all":true}');
  });

  it("preserves multipart boundaries and streams binary responses", async () => {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([0, 1, 2])]), "sample.bin");
    const request = new Request("https://web.bidveda.space/api/documents", {
      method: "POST",
      body: form,
    });
    const send = accepted(
      new Response(new Uint8Array([0, 255, 1]), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename=sample.bin",
        },
      }),
    );
    const result = await proxyApiRequest(request, environment, send);
    const init = send.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("content-type")).toBe(
      request.headers.get("content-type"),
    );
    expect(init.body).toBe(request.body);
    expect(result.headers.get("content-disposition")).toBe(
      "attachment; filename=sample.bin",
    );
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 1]),
    );
  });

  it("forwards HEAD and OPTIONS without inventing a body", async () => {
    const headSend = accepted(new Response(null, { status: 200 }));
    const head = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/health", { method: "HEAD" }),
      environment,
      headSend,
    );
    expect(head.status).toBe(200);
    expect(headSend.mock.calls[0]![1]?.body).toBeNull();
    const optionsSend = accepted(new Response(null, { status: 204 }));
    const options = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/auth/csrf", {
        method: "OPTIONS",
      }),
      environment,
      optionsSend,
    );
    expect(options.status).toBe(204);
    expect(optionsSend.mock.calls[0]![1]?.method).toBe("OPTIONS");
  });

  it.each([401, 403, 429])(
    "preserves an API %i response without inventing user authority",
    async (status) => {
      const send = accepted(
        Response.json({ error: { code: "DENIED" } }, { status }),
      );
      const result = await proxyApiRequest(
        new Request("https://web.bidveda.space/api/private"),
        environment,
        send,
      );
      expect(result.status).toBe(status);
      expect(await result.json()).toEqual({ error: { code: "DENIED" } });
    },
  );

  it.each([
    ["missing origin", { ...environment, API_PROXY_ORIGIN: undefined }],
    [
      "HTTP origin",
      { ...environment, API_PROXY_ORIGIN: "http://api-staging.bidveda.space" },
    ],
    [
      "origin with path",
      {
        ...environment,
        API_PROXY_ORIGIN: "https://api-staging.bidveda.space/extra",
      },
    ],
    [
      "origin with credentials",
      {
        ...environment,
        API_PROXY_ORIGIN: "https://user:pass@api-staging.bidveda.space",
      },
    ],
    ["missing ID", { ...environment, CF_ACCESS_CLIENT_ID: undefined }],
    ["missing secret", { ...environment, CF_ACCESS_CLIENT_SECRET: undefined }],
  ])("fails closed for %s", async (_name, env) => {
    const send = accepted();
    const result = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/health"),
      env,
      send,
    );
    expect(result.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain("server-client-secret");
  });

  it.each([
    "https://web.bidveda.space/other",
    "https://web.bidveda.space/api/%2F%2Fevil.example",
    "https://web.bidveda.space/api/https://evil.example/",
  ])("rejects an unsafe route %s", async (url) => {
    const send = accepted();
    expect(
      (await proxyApiRequest(new Request(url), environment, send)).status,
    ).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not follow Access redirects or leak upstream response bodies", async () => {
    const send = accepted(
      new Response("Access login secret", {
        status: 302,
        headers: { Location: "https://evil.example/collect" },
      }),
    );
    const result = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/private"),
      environment,
      send,
    );
    expect(result.status).toBe(502);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.text()).not.toContain("Access login secret");
  });

  it("rejects an HTML Access challenge even when its status is 200", async () => {
    const send = accepted(
      new Response("<html>Access login</html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    const result = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/private"),
      environment,
      send,
    );
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("Access login");
  });

  it("returns a generic no-store error without logging on upstream failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("server-client-secret"));
    const result = await proxyApiRequest(
      new Request("https://web.bidveda.space/api/private"),
      environment,
      send,
    );
    expect(result.status).toBe(502);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).not.toContain("server-client-secret");
    expect(log).not.toHaveBeenCalled();
  });
});
