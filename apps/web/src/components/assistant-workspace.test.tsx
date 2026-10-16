import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantWorkspace } from "./assistant-workspace";
const { apiRequest, replace } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace }),
}));
vi.mock("../lib/api", () => ({
  apiRequest,
  PublicApiError: class extends Error {},
  formatApiError: (_e: unknown, fallback: string) => fallback,
}));
describe("shared conversation browser", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    replace.mockReset();
    apiRequest.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/tenders")
          ? [{ id: "tender-1", title: "Equipment supply" }]
          : [
              { id: "chat-1", title: null, tenderId: "tender-1", pinned: true },
              {
                id: "chat-2",
                title: "Workspace help",
                tenderId: null,
                pinned: false,
              },
            ],
      ),
    );
  });
  it("groups server conversations into Projects, Workspace, Recent and Pinned without dropping untitled chats", async () => {
    render(<AssistantWorkspace organisationId="org-1" />);
    expect(
      await within(screen.getByRole("region", { name: "Projects" })).findByRole(
        "button",
        { name: "Untitled conversation" },
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Workspace" })).getByRole(
        "button",
        { name: "Workspace help" },
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Recent" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(4);
    expect(
      within(screen.getByRole("region", { name: "Pinned" })).getByRole(
        "button",
        { name: "Untitled conversation" },
      ),
    ).toBeInTheDocument();
  });
  it("selects the exact chat and exposes pin and delete in its three-dot menu", async () => {
    const user = userEvent.setup();
    render(<AssistantWorkspace organisationId="org-1" />);
    const pinned = within(screen.getByRole("region", { name: "Pinned" }));
    await user.click(
      await pinned.findByRole("button", { name: "Untitled conversation" }),
    );
    expect(replace).toHaveBeenCalledWith(
      "/assistant/org-1?conversation=chat-1",
      { scroll: false },
    );
    await user.click(
      pinned.getByRole("button", { name: "Actions for Untitled conversation" }),
    );
    expect(screen.getAllByRole("menuitem", { name: "Unpin" })).toHaveLength(1);
    await user.click(pinned.getByRole("menuitem", { name: "Unpin" }));
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org-1/conversations/chat-1",
      { method: "PATCH", body: JSON.stringify({ pinned: false }) },
    );

    await user.click(
      pinned.getByRole("button", { name: "Actions for Untitled conversation" }),
    );
    await user.click(pinned.getByRole("menuitem", { name: "Delete" }));
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org-1/conversations/chat-1",
      { method: "PATCH", body: JSON.stringify({ archived: true }) },
    );
  });
  it("filters history and creates no empty record when New chat is selected", async () => {
    const user = userEvent.setup();
    render(<AssistantWorkspace organisationId="org-1" />);
    await screen.findAllByText("Workspace help");
    await user.type(
      screen.getByRole("textbox", { name: "Search chats" }),
      "unmatched",
    );
    expect(screen.queryByText("Workspace help")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ New chat" }));
    expect(
      apiRequest.mock.calls.some(
        ([, options]) =>
          (options as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });
});
