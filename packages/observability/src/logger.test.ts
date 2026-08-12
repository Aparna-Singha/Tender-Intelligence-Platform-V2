import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { redactionPaths } from "./logger.js";

describe("structured logging", () => {
  it("supports redaction of security-sensitive values", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(
      {
        redact: { censor: "[REDACTED]", paths: redactionPaths },
      },
      destination,
    );

    logger.info({
      DATABASE_URL: "postgresql://user:secret@localhost/db",
      body: { password: "private-value" },
      prompt: "private prompt text",
      password: "private-value",
      req: { headers: { authorization: "Bearer private-token" } },
      signedUrl: "https://storage.example.test/private?signature=abc",
    });
    await new Promise<void>((resolve) => {
      destination.end(resolve);
    });

    const output = chunks.join("");
    expect(output).not.toContain("private-value");
    expect(output).not.toContain("private-token");
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("private prompt text");
    expect(output).not.toContain("signature=abc");
    expect(output).toContain("[REDACTED]");
  });
});
