import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@tender/database";
import { describe, expect, it, vi } from "vitest";

import { AuthController } from "../src/auth/auth.controller.js";
import { AuthService } from "../src/auth/auth.service.js";
import { CookieService } from "../src/common/cookies.js";
import { ScryptPasswordHasher } from "../src/common/security-crypto.js";

const environment = {
  COOKIE_SECRET: "a-secret-used-only-for-tests-123456789",
  SESSION_COOKIE_SECURE: false,
  SESSION_TTL_SECONDS: 3600,
  WEB_ORIGIN: "http://localhost:3000",
} as never;

const context = {
  ip: "127.0.0.1",
  requestId: "request-auth-123",
  userAgent: "vitest",
};

const registerInput = {
  display_name: "Test User",
  email: "user@example.test",
  password: "StrongPassword123",
};

function uniqueEmailError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    clientVersion: "test",
    code: "P2002",
    meta: { target: ["email"] },
  });
}

function uniqueEmailIndexError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    clientVersion: "test",
    code: "P2002",
    meta: { target: "users_email_key" },
  });
}

function driverAdapterUniqueEmailError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    clientVersion: "test",
    code: "P2002",
    meta: {
      driverAdapterError: {
        cause: {
          constraint: {
            fields: ["email"],
          },
          kind: "UniqueConstraintViolation",
          originalCode: "23505",
        },
        name: "DriverAdapterError",
      },
      modelName: "User",
    },
  });
}

function postgresUniqueEmailError(): Error & {
  readonly code: string;
  readonly constraint: string;
} {
  return Object.assign(new Error("unique violation"), {
    code: "23505",
    constraint: "users_email_key",
  });
}

function databaseAuthError(): Prisma.PrismaClientInitializationError {
  return new Prisma.PrismaClientInitializationError(
    "Authentication failed against database server at db.example.test",
    "test",
  );
}

function createService(database: unknown): AuthService {
  return new AuthService(environment, database as never, {} as never);
}

function transactionMock<TTransaction>(
  transaction: TTransaction,
): ReturnType<typeof vi.fn> {
  return vi.fn((callback: (value: TTransaction) => unknown) =>
    Promise.resolve(callback(transaction)),
  );
}

describe("AuthService registration reliability", () => {
  it("registers a user, session and audit event atomically", async () => {
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      session: { create: vi.fn().mockResolvedValue({ id: "session-a" }) },
      user: {
        create: vi.fn().mockResolvedValue({
          displayName: "Test User",
          email: "user@example.test",
          id: "user-a",
        }),
      },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    const result = await createService(database).register(
      registerInput,
      context,
    );

    expect(result.user).toMatchObject({ id: "user-a" });
    expect(result.session).toMatchObject({ id: "session-a" });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "LOGIN_SUCCEEDED",
        requestId: "request-auth-123",
        subjectId: "session-a",
      }),
    });
  });

  it("maps a true duplicate email constraint to conflict", async () => {
    const transaction = {
      user: { create: vi.fn().mockRejectedValue(uniqueEmailError()) },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("maps a named email unique index to conflict", async () => {
    const transaction = {
      user: { create: vi.fn().mockRejectedValue(uniqueEmailIndexError()) },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("maps a PostgreSQL email unique violation to conflict", async () => {
    const transaction = {
      user: { create: vi.fn().mockRejectedValue(postgresUniqueEmailError()) },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("maps Prisma driver-adapter email unique metadata to conflict", async () => {
    const transaction = {
      user: {
        create: vi.fn().mockRejectedValue(driverAdapterUniqueEmailError()),
      },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not report database authentication failure as conflict", async () => {
    const database = {
      $transaction: vi.fn().mockRejectedValue(databaseAuthError()),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not leave a user write outside the failed session/audit transaction", async () => {
    const transaction = {
      auditEvent: { create: vi.fn() },
      session: { create: vi.fn().mockRejectedValue(databaseAuthError()) },
      user: {
        create: vi.fn().mockResolvedValue({
          displayName: "Test User",
          email: "user@example.test",
          id: "user-a",
        }),
      },
    };
    const database = {
      $transaction: transactionMock(transaction),
    };

    await expect(
      createService(database).register(registerInput, context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("AuthService login reliability", () => {
  it("keeps invalid credentials unauthorized at the controller boundary", async () => {
    const passwordHash = await new ScryptPasswordHasher().hash(
      "CorrectPassword123",
    );
    const service = createService({
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          email: "user@example.test",
          id: "user-a",
          passwordHash,
        }),
      },
    });
    const controller = new AuthController(
      service,
      new CookieService(environment),
      {} as never,
    );

    await expect(
      controller.login(
        { email: "user@example.test", password: "WrongPassword123" },
        {
          headers: {},
          id: "request-auth-123",
          ip: "127.0.0.1",
        } as never,
        { header: vi.fn() } as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  }, 30_000);

  it("does not report database failure as invalid credentials", async () => {
    const database = {
      user: { findUnique: vi.fn().mockRejectedValue(databaseAuthError()) },
    };

    await expect(
      createService(database).login(
        { email: "user@example.test", password: "StrongPassword123" },
        context,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("creates successful login session and audit event in one transaction", async () => {
    const passwordHash = await new ScryptPasswordHasher().hash(
      "StrongPassword123",
    );
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      session: { create: vi.fn().mockResolvedValue({ id: "session-a" }) },
    };
    const database = {
      $transaction: transactionMock(transaction),
      user: {
        findUnique: vi.fn().mockResolvedValue({
          displayName: "Test User",
          email: "user@example.test",
          id: "user-a",
          passwordHash,
        }),
      },
    };

    await expect(
      createService(database).login(
        { email: "user@example.test", password: "StrongPassword123" },
        context,
      ),
    ).resolves.toMatchObject({ session: { id: "session-a" } });
    expect(transaction.auditEvent.create).toHaveBeenCalledOnce();
  }, 30_000);
});
