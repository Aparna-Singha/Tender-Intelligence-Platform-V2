import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationsService,
  conversationTitle,
} from "../src/rag/conversations.service.js";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve inferred mock signatures in this test fixture.
function fixture() {
  const db = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(db),
    ),
    ragConversation: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: "conversation", tenderId: null }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "conversation" }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ragMessage: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn(),
    },
    tender: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, service: new ConversationsService(db as never) };
}

describe("shared conversations", () => {
  it("creates workspace conversations with server-derived identity and no tender/index", async () => {
    const { db, service } = fixture();
    await service.create("org", "user", "Settings");
    expect(db.ragConversation.create).toHaveBeenCalledWith({
      data: {
        organisationId: "org",
        createdByUserId: "user",
        sourceMode: "TENDER_ONLY",
        title: "New conversation",
        context: "Settings",
      },
    });
  });
  it("lists active tenant conversations in deterministic recent order", async () => {
    const { db, service } = fixture();
    await service.list("org", 50);
    expect(db.ragConversation.findMany).toHaveBeenCalledWith({
      where: { organisationId: "org", deletedAt: null, status: "ACTIVE" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
    });
  });
  it("does not expose another organisation's transcript or accept a pin update", async () => {
    const { db, service } = fixture();
    db.ragConversation.findFirst.mockResolvedValue(null);
    db.ragConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.load("other-org", "conversation"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update("other-org", "conversation", { pinned: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.ragConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organisationId: "other-org",
          id: "conversation",
          deletedAt: null,
        },
      }),
    );
  });
  it("persists both messages atomically, derives first-message title and advances activity", async () => {
    const { db, service } = fixture();
    await service.send(
      "org",
      "conversation",
      "Summarise tenders",
      "request-1",
      "user",
    );
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.ragMessage.createMany).toHaveBeenCalledWith({
      data: [
        {
          organisationId: "org",
          conversationId: "conversation",
          role: "USER",
          content: "Summarise tenders",
          sequence: 1,
          clientKey: "request-1",
          createdByUserId: "user",
        },
        {
          organisationId: "org",
          conversationId: "conversation",
          role: "ASSISTANT",
          content: "There are no tenders in this workspace.",
          sequence: 2,
        },
      ],
    });
    expect(db.ragConversation.update).toHaveBeenCalledWith({
      where: { id: "conversation" },
      data: { title: "Summarise tenders", updatedAt: expect.any(Date) },
    });
  });
  it("deduplicates a retry before storing another pair", async () => {
    const { db, service } = fixture();
    db.ragMessage.findFirst.mockResolvedValue({ id: "existing" });
    await service.send("org", "conversation", "hello", "request-1", "user");
    expect(db.ragMessage.createMany).not.toHaveBeenCalled();
  });
  it("refuses to bypass tender RAG with a workspace message", async () => {
    const { db, service } = fixture();
    db.ragConversation.findFirst.mockResolvedValue({
      id: "conversation",
      tenderId: "tender",
    });
    await expect(
      service.send("org", "conversation", "hello", "request-1", "user"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.ragMessage.createMany).not.toHaveBeenCalled();
  });
  it.each([true, false])("stores pin state %s", async (pinned) => {
    const { db, service } = fixture();
    await service.update("org", "conversation", { pinned });
    expect(db.ragConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pinned } }),
    );
  });
  it("bounds deterministic titles without AI", () => {
    expect(conversationTitle("  Delivery\n clause  ")).toBe("Delivery clause");
    expect(conversationTitle("x".repeat(200))).toHaveLength(80);
  });
});
