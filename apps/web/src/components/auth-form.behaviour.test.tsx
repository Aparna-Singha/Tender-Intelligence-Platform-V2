import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const { apiRequest, push } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

describe("authentication form behaviour", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    push.mockReset();
  });
  it("explains registration password requirements and toggles visibility", async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="register" />);
    expect(
      screen.getByText(
        /at least 12 characters with uppercase, lowercase and a number/i,
      ),
    ).toBeInTheDocument();
    const password = screen.getByLabelText(/Password/);
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
  });
  it("shows a rejected login error and preserves entered values", async () => {
    apiRequest.mockRejectedValueOnce(
      new Error("Email or password is incorrect."),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(
      screen.getByLabelText(/Email address/),
      "person@example.com",
    );
    await user.type(screen.getByLabelText(/Password/), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email or password is incorrect.",
    );
    expect(screen.getByLabelText(/Email address/)).toHaveValue(
      "person@example.com",
    );
  });
  it("redirects after successful login and blocks duplicate submission", async () => {
    let resolveRequest: (() => void) | undefined;
    apiRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(
      screen.getByLabelText(/Email address/),
      "person@example.com",
    );
    await user.type(screen.getByLabelText(/Password/), "valid-password");
    await user.dblClick(screen.getByRole("button", { name: "Log in" }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });
});
