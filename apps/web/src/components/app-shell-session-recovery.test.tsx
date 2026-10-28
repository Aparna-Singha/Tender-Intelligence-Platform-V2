import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, clearCsrfToken } from "../lib/api";
import { AppShell } from "./app-shell";

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

describe("app shell session recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfToken();
    router.replace.mockReset();
  });

  it("retries one stale session read after a concurrent mutation", async () => {
    let releaseOldSession!: (response: Response) => void;
    const oldSession = new Promise<Response>((resolve) => {
      releaseOldSession = resolve;
    });
    let sessionReads = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(url).pathname;
      if (path === "/auth/session") {
        sessionReads += 1;
        return sessionReads === 1
          ? oldSession
          : Promise.resolve(
              Response.json({
                data: {
                  active_organisation_id: "org-2",
                  user: {
                    display_name: "Aparna",
                    email: "aparna@example.test",
                  },
                },
              }),
            );
      }
      if (path === "/organisations")
        return Promise.resolve(
          Response.json({
            data: [
              {
                organisation: { id: "org-2", name: "Second", type: "MSME" },
                role: "OWNER",
              },
            ],
          }),
        );
      if (path === "/organisations/org-2/tenders")
        return Promise.resolve(Response.json({ data: [] }));
      if (path === "/auth/csrf")
        return Promise.resolve(
          Response.json({ data: { csrf_token: "synthetic-csrf" } }),
        );
      if (path === "/organisations/org-2/select")
        return Promise.resolve(Response.json({ data: { selected: true } }));
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell>
        <div>Dashboard content</div>
      </AppShell>,
    );
    await waitFor(() => expect(sessionReads).toBe(1));
    await apiRequest("/organisations/org-2/select", { method: "POST" });
    act(() => {
      releaseOldSession(
        Response.json({
          data: {
            active_organisation_id: "org-1",
            user: { display_name: "Aparna", email: "aparna@example.test" },
          },
        }),
      );
    });
    expect(
      await screen.findByRole("link", { name: "AI Chat" }),
    ).toHaveAttribute("href", "/assistant/org-2");
    expect(sessionReads).toBe(2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(["/auth/session", "/organisations"])(
    "offers a manual retry after a transient %s failure",
    async (failedPath) => {
      const user = userEvent.setup();
      let attempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const path = new URL(url).pathname;
          if (path === failedPath && ++attempts === 1)
            return Promise.resolve(
              Response.json(
                {
                  error: {
                    code: "STALE_RESPONSE",
                    message: "Private upstream detail",
                  },
                },
                { status: 502 },
              ),
            );
          if (path === "/auth/session")
            return Promise.resolve(
              Response.json({
                data: {
                  active_organisation_id: "org-1",
                  user: {
                    display_name: "Aparna",
                    email: "aparna@example.test",
                  },
                },
              }),
            );
          if (path === "/organisations")
            return Promise.resolve(
              Response.json({
                data: [
                  {
                    organisation: {
                      id: "org-1",
                      name: "Tender Ops",
                      type: "MSME",
                    },
                    role: "OWNER",
                  },
                ],
              }),
            );
          if (path === "/organisations/org-1/tenders")
            return Promise.resolve(Response.json({ data: [] }));
          throw new Error(`Unexpected request: ${path}`);
        }),
      );

      render(
        <AppShell>
          <div>Dashboard content</div>
        </AppShell>,
      );
      const retry = await screen.findByRole("button", {
        name: "Try loading workspace again",
      });
      expect(attempts).toBe(1);
      expect(screen.queryByText("Private upstream detail")).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
      await user.click(retry);
      expect(
        await screen.findByRole("link", { name: "AI Chat" }),
      ).toHaveAttribute("href", "/assistant/org-1");
      expect(attempts).toBe(2);
      expect(
        screen.queryByRole("button", { name: "Try loading workspace again" }),
      ).toBeNull();
    },
  );

  it.each([
    [401, "/auth/session"],
    [403, "/organisations"],
  ])(
    "does not retry a %i authorization failure at %s",
    async (status, failedPath) => {
      let attempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const path = new URL(url).pathname;
          if (path === failedPath) {
            attempts += 1;
            return Promise.resolve(
              Response.json({ error: { code: "STALE_RESPONSE" } }, { status }),
            );
          }
          if (path === "/auth/session")
            return Promise.resolve(
              Response.json({
                data: {
                  active_organisation_id: "org-1",
                  user: {
                    display_name: "Aparna",
                    email: "aparna@example.test",
                  },
                },
              }),
            );
          if (path === "/organisations")
            return Promise.resolve(Response.json({ data: [] }));
          throw new Error(`Unexpected request: ${path}`);
        }),
      );

      render(
        <AppShell>
          <div>Dashboard content</div>
        </AppShell>,
      );
      if (status === 401)
        await waitFor(() =>
          expect(router.replace).toHaveBeenCalledWith("/login"),
        );
      else
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Workspace access denied",
        );
      expect(attempts).toBe(1);
      expect(
        screen.queryByRole("button", { name: "Try loading workspace again" }),
      ).toBeNull();
    },
  );
});
