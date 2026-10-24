import { describe, expect, it, vi, type Mock } from "vitest";
import { createHandler } from "../src/index.js";

const origin = "https://staging.bidveda.space";
const token = "A".repeat(43);
const env = {
  ALLOWED_FRONTEND_ORIGIN: origin,
  EMAIL_ADAPTER_TOKEN: "adapter-secret-long-enough",
  RESEND_API_KEY: "resend-secret",
};
const invitation = {
  from: "notifications@send.bidveda.space",
  template: "invitation",
  to: "member@example.com",
  variables: { invitation_url: `${origin}/accept-invitation?token=${token}` },
};
const reset = {
  ...invitation,
  template: "password_reset",
  variables: { reset_url: `${origin}/reset-password?token=${token}` },
};

function request(
  body: unknown = invitation,
  authorization = `Bearer ${env.EMAIL_ADAPTER_TOKEN}`,
): Request {
  return new Request("https://adapter.example/deliver", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function accepted(): Mock<typeof fetch> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: "receipt-id" }));
}

describe("BidVeda staging mail adapter", () => {
  it.each(["", "Bearer invalid", "Basic adapter-secret-long-enough"])(
    "rejects unauthorized requests before delivery",
    async (authorization) => {
      const send = accepted();
      expect(
        (await createHandler(send)(request(invitation, authorization), env))
          .status,
      ).toBe(401);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("permits only POST to the delivery route", async () => {
    const send = accepted();
    const handle = createHandler(send);
    expect(
      (await handle(new Request("https://adapter.example/deliver"), env))
        .status,
    ).toBe(405);
    expect(
      (await handle(new Request("https://adapter.example/other"), env)).status,
    ).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["sender spoofing", { ...invitation, from: "attacker@example.com" }],
    [
      "recipient list",
      { ...invitation, to: ["a@example.com", "b@example.com"] },
    ],
    [
      "header injection",
      { ...invitation, to: "a@example.com\r\nBcc: b@example.com" },
    ],
    ["extra subject", { ...invitation, subject: "User controlled" }],
    ["unknown template", { ...invitation, template: "custom" }],
    [
      "extra variable",
      { ...invitation, variables: { ...invitation.variables, subject: "x" } },
    ],
    [
      "wrong path",
      {
        ...invitation,
        variables: {
          invitation_url: `${origin}/reset-password?token=${token}`,
        },
      },
    ],
    [
      "wrong origin",
      {
        ...invitation,
        variables: {
          invitation_url: `https://evil.example/accept-invitation?token=${token}`,
        },
      },
    ],
    [
      "HTTP link",
      {
        ...invitation,
        variables: {
          invitation_url: `http://staging.bidveda.space/accept-invitation?token=${token}`,
        },
      },
    ],
    [
      "extra query",
      {
        ...invitation,
        variables: {
          invitation_url: `${origin}/accept-invitation?token=${token}&redirect=https://evil.example`,
        },
      },
    ],
    [
      "missing token",
      {
        ...invitation,
        variables: { invitation_url: `${origin}/accept-invitation` },
      },
    ],
  ])("rejects %s", async (_name, body) => {
    const send = accepted();
    expect((await createHandler(send)(request(body), env)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects oversized requests even without a declared content length", async () => {
    const send = accepted();
    const oversized = { ...invitation, to: "a".repeat(5_000) };
    expect((await createHandler(send)(request(oversized), env)).status).toBe(
      413,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed when the frontend origin is missing or invalid", async () => {
    const send = accepted();
    expect(
      (
        await createHandler(send)(request(), {
          ...env,
          ALLOWED_FRONTEND_ORIGIN: "http://staging.bidveda.space",
        })
      ).status,
    ).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invitation",
      invitation,
      "You're invited to BidVeda",
      "Accept invitation",
    ],
    ["password reset", reset, "Reset your BidVeda password", "Reset password"],
  ])(
    "sends the fixed %s template with HTML and text",
    async (_name, body, subject, action) => {
      const send = accepted();
      const result = await createHandler(send)(request(body), env);
      expect(result.status).toBe(204);
      const [url, init] = send.mock.calls[0]!;
      expect(url).toBe("https://api.resend.com/emails");
      expect(init?.headers).toEqual({
        Authorization: "Bearer resend-secret",
        "Content-Type": "application/json",
      });
      const payload = JSON.parse(init?.body as string) as Record<
        string,
        string
      >;
      expect(payload.from).toBe("notifications@send.bidveda.space");
      expect(payload.to).toBe("member@example.com");
      expect(payload.subject).toBe(subject);
      expect(payload.html).toContain(action);
      expect(payload.text).toContain(action);
      expect(payload.html).toContain("?token=");
      expect(payload.text).toContain("?token=");
      expect(Object.keys(payload).sort()).toEqual([
        "from",
        "html",
        "subject",
        "text",
        "to",
      ]);
    },
  );

  it("escapes link query delimiters in HTML", async () => {
    const send = accepted();
    await createHandler(send)(request(invitation), env);
    const payload = JSON.parse(send.mock.calls[0]![1]?.body as string) as {
      html: string;
      text: string;
    };
    expect(payload.html).toContain(`?token=${token}`);
    expect(payload.html).not.toContain("<script>");
    expect(payload.text).toContain(invitation.variables.invitation_url);
  });

  it.each([
    [
      "HTTP error",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("upstream secret", { status: 429 })),
    ],
    [
      "network error",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("secret URL")),
    ],
    [
      "missing receipt",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    ],
  ])("returns a generic failure for %s", async (_name, send) => {
    const result = await createHandler(send)(request(reset), env);
    expect(result.status).toBe(502);
    expect(await result.text()).toBe("");
  });
});
