import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PrismaClient } from "@tender/database";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";

export function conversationTitle(question: string): string {
  return (
    question.trim().replace(/\s+/g, " ").slice(0, 80) || "New conversation"
  );
}

@Injectable()
export class ConversationsService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public list(organisationId: string, limit: number): Promise<unknown> {
    return this.database.ragConversation.findMany({
      where: { organisationId, deletedAt: null, status: "ACTIVE" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  }

  public create(
    organisationId: string,
    userId: string,
    context?: string,
  ): Promise<unknown> {
    return this.database.ragConversation.create({
      data: {
        organisationId,
        createdByUserId: userId,
        sourceMode: "TENDER_ONLY",
        title: "New conversation",
        context: context ?? "Workspace",
      },
    });
  }

  public async load(organisationId: string, id: string): Promise<unknown> {
    const conversation = await this.database.ragConversation.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: {
        messages: { orderBy: { sequence: "asc" } },
        answerRuns: {
          include: { citations: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (conversation === null) throw new NotFoundException();
    return conversation;
  }

  public async update(
    organisationId: string,
    id: string,
    input: {
      pinned?: boolean | undefined;
      title?: string | undefined;
      archived?: boolean | undefined;
    },
  ): Promise<unknown> {
    const result = await this.database.ragConversation.updateMany({
      where: { id, organisationId, deletedAt: null },
      data: {
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.archived === undefined
          ? {}
          : {
              status: input.archived ? "ARCHIVED" : "ACTIVE",
              archivedAt: input.archived ? new Date() : null,
            }),
      },
    });
    if (result.count !== 1) throw new NotFoundException();
    return this.load(organisationId, id);
  }

  public async send(
    organisationId: string,
    id: string,
    question: string,
    clientKey: string,
    userId: string,
  ): Promise<unknown> {
    await this.database.$transaction(async (tx) => {
      // Serialize sends before allocating message sequence numbers.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rag_conversations WHERE id=${id}::uuid AND organisation_id=${organisationId}::uuid FOR UPDATE`,
      );
      const conversation = await tx.ragConversation.findFirst({
        where: { id, organisationId, deletedAt: null, status: "ACTIVE" },
      });
      if (conversation === null) throw new NotFoundException();
      if (conversation.tenderId !== null)
        throw new ConflictException(
          "Use the cited tender question endpoint for tender conversations",
        );
      if (
        (await tx.ragMessage.findFirst({
          where: { conversationId: id, organisationId, clientKey },
        })) !== null
      )
        return;
      const last = await tx.ragMessage.findFirst({
        where: { conversationId: id, organisationId },
        orderBy: { sequence: "desc" },
      });
      const sequence = last?.sequence ?? 0;
      // Workspace answers are deterministic views of authorised records, never invented tender findings.
      const tenders = await tx.tender.findMany({
        where: { organisationId, deletedAt: null },
        select: { title: true, submissionDeadline: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      let answer =
        "I don't have supporting records for that question. Open a tender chat for cited document answers. Final eligibility and bid content require human review.";
      if (/tender|pipeline|deadline|summar/i.test(question)) {
        answer =
          tenders.length === 0
            ? "There are no tenders in this workspace."
            : `Current workspace tender records (${tenders.length} shown):\n${tenders.map((t) => `${t.title}${t.submissionDeadline === null ? " — no deadline recorded" : ` — deadline ${t.submissionDeadline.toISOString()}`}`).join("\n")}\nSource: workspace tender records at ${new Date().toISOString()}. These are recorded metadata, not an eligibility assessment.`;
      } else if (/account|settings|where|upload|document/i.test(question)) {
        answer =
          "Use Account for your profile and sessions, Settings for organisation settings, and Company Docs for reusable company evidence. Upload tender source files inside that tender's workspace. I cannot infer unrecorded account or company facts.";
      }
      await tx.ragMessage.createMany({
        data: [
          {
            organisationId,
            conversationId: id,
            role: "USER",
            content: question,
            sequence: sequence + 1,
            clientKey,
            createdByUserId: userId,
          },
          {
            organisationId,
            conversationId: id,
            role: "ASSISTANT",
            content: answer,
            sequence: sequence + 2,
          },
        ],
      });
      await tx.ragConversation.update({
        where: { id },
        data: {
          updatedAt: new Date(),
          ...(sequence === 0 ? { title: conversationTitle(question) } : {}),
        },
      });
    });
    return this.load(organisationId, id);
  }
}
