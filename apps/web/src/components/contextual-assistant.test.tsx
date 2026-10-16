import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextualAssistant } from "./contextual-assistant";

vi.mock("./rag-chatbot", () => ({
  RagChatbot: ({
    onConversationChange,
  }: {
    onConversationChange: (id: string) => void;
  }) => (
    <button onClick={() => onConversationChange("saved-tender-chat")}>
      Send tender question
    </button>
  ),
}));
vi.mock("./workspace-conversation", () => ({
  WorkspaceConversation: ({
    onConversationChange,
  }: {
    onConversationChange: (id: string) => void;
  }) => (
    <button onClick={() => onConversationChange("saved-workspace-chat")}>
      Send workspace question
    </button>
  ),
}));

describe("contextual assistant", () => {
  it("opens without navigating and expands the exact tender ID instead of the new-chat selector", async () => {
    const user = userEvent.setup();
    const url = window.location.href;
    render(
      <ContextualAssistant
        context="this tender"
        organisationId="org"
        tenderId="tender"
        versionId="version"
        openInChatHref="/tenders/org/tender?stage=ask&conversation=new"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Ask about this tender/ }),
    );
    expect(window.location.href).toBe(url);
    expect(
      screen.getByRole("complementary", { name: "AI Assistant popup" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Send tender question" }),
    );
    expect(
      screen.getByRole("link", { name: "Open in AI Chat" }),
    ).toHaveAttribute(
      "href",
      "/tenders/org/tender?stage=ask&conversation=saved-tender-chat",
    );
    await user.click(
      screen.getByRole("button", { name: "Close AI Assistant" }),
    );
    expect(
      screen.queryByRole("complementary", { name: "AI Assistant popup" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Ask about this tender/ }),
    );
    expect(
      screen.getByRole("link", { name: "Open in AI Chat" }),
    ).toHaveAttribute(
      "href",
      "/tenders/org/tender?stage=ask&conversation=saved-tender-chat",
    );
  });
  it.each(["settings", "my account"])(
    "uses a saved workspace conversation for %s",
    async (context) => {
      const user = userEvent.setup();
      render(
        <ContextualAssistant
          context={context}
          organisationId="org"
          openInChatHref="/assistant/org"
        />,
      );
      await user.click(
        screen.getByRole("button", {
          name: new RegExp(`Ask about ${context}`),
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Send workspace question" }),
      );
      expect(
        screen.getByRole("link", { name: "Open in AI Chat" }),
      ).toHaveAttribute(
        "href",
        "/assistant/org?conversation=saved-workspace-chat",
      );
      expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    },
  );
});
