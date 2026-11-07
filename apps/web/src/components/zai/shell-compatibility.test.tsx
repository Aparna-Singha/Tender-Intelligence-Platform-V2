import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShellView, type ShellData } from "./shell-view";
import { ContextualAssistant } from "../contextual-assistant";

vi.mock("../workspace-conversation", () => ({
  WorkspaceConversation: () => <button>Assistant action</button>,
}));
vi.mock("../rag-chatbot", () => ({ RagChatbot: () => null }));
const data: ShellData = {
  page: "dashboard",
  pathname: "/dashboard",
  activeOrgId: "org",
  activeTenderId: null,
  organizations: [
    {
      id: "org",
      name: "Synthetic organisation",
      role: "OWNER",
      initials: "SO",
      color: "orange",
    },
  ],
  tenders: [],
  activeStage: null,
  userName: "Synthetic User",
  userEmail: "test@example.test",
  busy: false,
  setPage: vi.fn(),
  hrefFor: () => "/dashboard",
  setActiveOrg: vi.fn(),
  openTender: vi.fn(),
  signOut: vi.fn(),
};

describe("navigation over the contextual assistant", () => {
  it("collapses the desktop rail without losing navigation or keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <ShellView data={data}>
        <p>Home content</p>
      </ShellView>,
    );
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(screen.getByTestId("desktop-sidebar")).getByRole("link", {
        name: "Home",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
  it("keeps the Tenders sidebar entry active on tender detail pages", () => {
    render(
      <ShellView
        data={{
          ...data,
          activeTenderId: "tender-1",
          page: "tenders",
          pathname: "/tenders/org/tender-1",
        }}
      >
        <p>Tender details</p>
      </ShellView>,
    );

    const tenderLinks = screen.getAllByRole("link", { name: "Tenders" });
    expect(
      tenderLinks.some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });
  it("traps focus, handles Escape and restores the opener without closing the assistant", async () => {
    const user = userEvent.setup();
    render(
      <ShellView data={data}>
        <ContextualAssistant
          context="this workspace"
          organisationId="org"
          openInChatHref="/assistant/org"
        />
      </ShellView>,
    );
    await user.click(
      screen.getByRole("button", { name: /Ask about this workspace/ }),
    );
    expect(
      screen.getByRole("button", { name: "Assistant action" }),
    ).toBeVisible();
    const opener = screen.getByRole("button", { name: "Open navigation" });
    const assistantAction = screen.getByRole("button", {
      name: "Assistant action",
    });

    assistantAction.focus();
    expect(assistantAction).toHaveFocus();

    // Simulate opening navigation without focusing its button first.
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toHaveClass("z-[70]");
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toHaveClass(
      "z-[70]",
    );
    expect(
      screen.queryByRole("button", { name: "Assistant action" }),
    ).not.toBeInTheDocument();
    for (let i = 0; i < 18; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Assistant action" }),
    ).toBeVisible();
    await user.click(opener);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    const overlay = document.querySelector<HTMLElement>(
      '[data-slot="sheet-overlay"]',
    );
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Assistant action" }),
    ).toBeVisible();
  });
});
