import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./dashboard";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("dashboard organisation flow", () => {
  beforeEach(() => {
    let created = false;
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/organisations" && init?.method === "POST") {
        created = true;
        return Promise.resolve({ id: "org-1" });
      }
      if (path === "/auth/session")
        return Promise.resolve({
          active_organisation_id: created ? "org-1" : null,
        });
      if (path === "/organisations")
        return Promise.resolve(
          created
            ? [
                {
                  organisation: {
                    id: "org-1",
                    name: "Acme Works",
                    type: "MSME",
                  },
                  role: "OWNER",
                },
              ]
            : [],
        );
      if (path.endsWith("/dashboard-recommendations"))
        return Promise.resolve({
          completeness: 0,
          display_mode: "BEGINNER",
          progress: {
            completed_steps: [],
            current_step: 1,
            status: "NOT_STARTED",
          },
          recommendations: [],
        });
      if (path.endsWith("/documents") || path.endsWith("/tenders"))
        return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });
  it("shows the empty state and creates an organisation without a stale form reference", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(
      await screen.findByRole("heading", { name: "Set up your workspace" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: /Create organisation/ })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "Create organisation" });
    await user.type(
      within(dialog).getByLabelText(/Organisation name/),
      "Acme Works",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create organisation" }),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText(/You are working in Acme Works/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Create organisation" }),
    ).not.toBeInTheDocument();
  });
});
