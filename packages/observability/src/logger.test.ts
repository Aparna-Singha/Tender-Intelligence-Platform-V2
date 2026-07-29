import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

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
        redact: {
          paths: ["password", "req.headers.authorization"],
          censor: "[REDACTED]",
        },
      },
      destination,
    );

    logger.info({
      password: "private-value",
      req: { headers: { authorization: "Bearer private-token" } },
    });
    await new Promise<void>((resolve) => {
      destination.end(resolve);
    });

    const output = chunks.join("");
    expect(output).not.toContain("private-value");
    expect(output).not.toContain("private-token");
    expect(output).toContain("[REDACTED]");
  });
});
