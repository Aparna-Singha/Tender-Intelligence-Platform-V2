import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "../../lib/api";
import { AuthScreen } from "./auth-screen";
const formInput = "SyntheticPass123"; // Synthetic form input; never a real credential.
const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
describe("prototype authentication with the real API client", () => {
  beforeEach(() => {
    router.push.mockReset();
    clearCsrfToken();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfToken();
  });
  it.each(["login", "register"] as const)(
    "sends %s through cookie and CSRF transport without simulated success",
    async (mode) => {
      let accept!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        accept = resolve;
      });
      const fetchMock = vi.fn((url: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "GET" && url.endsWith("/auth/csrf")
          ? Promise.resolve(
              Response.json({ data: { csrf_token: "synthetic-csrf" } }),
            )
          : pending,
      );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<AuthScreen mode={mode} />);
      expect(screen.getByLabelText("Email address")).toHaveValue("");
      if (mode === "register")
        await user.type(screen.getByLabelText("Full name"), "Test User");
      await user.type(
        screen.getByLabelText("Email address"),
        "synthetic@example.test",
      );
      await user.type(
        screen.getByLabelText("Password", { exact: true }),
        formInput,
      );
      await user.click(
        screen.getByRole("button", {
          name: mode === "login" ? "Sign in" : "Create account",
        }),
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(router.push).not.toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain(`/auth/${mode}`);
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe(
        "synthetic-csrf",
      );
      expect(
        JSON.parse(typeof init?.body === "string" ? init.body : "null"),
      ).toEqual({
        email: "synthetic@example.test",
        password: formInput,
        ...(mode === "register" ? { display_name: "Test User" } : {}),
      });
      accept(Response.json({ data: { authenticated: true } }));
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/dashboard"),
      );
    },
  );
  it.each([401, 403, 502])(
    "shows HTTP %s without fabricating a session; allows explicit retry",
    async (status) => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/auth/csrf")
            ? Response.json({ data: { csrf_token: "synthetic-csrf" } })
            : Response.json(
                {
                  error: {
                    code: "REQUEST_FAILED",
                    message: "Unable to sign in",
                  },
                  request_id: "synthetic-request",
                },
                { status },
              ),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<AuthScreen mode="login" />);
      await user.type(
        screen.getByLabelText("Email address"),
        "synthetic@example.test",
      );
      await user.type(
        screen.getByLabelText("Password", { exact: true }),
        formInput,
      );
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to sign in",
      );
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledTimes(status === 403 ? 4 : 2); // Existing API client performs one CSRF refresh on 403.
    },
  );
});
