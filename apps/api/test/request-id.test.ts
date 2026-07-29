import { describe, expect, it } from "vitest";

import { resolveRequestId } from "../src/common/request-id.js";

describe("resolveRequestId", () => {
  it("preserves a valid caller request ID", () => {
    expect(resolveRequestId("client-request_123")).toBe("client-request_123");
  });

  it.each(["", "contains spaces", "contains\nnewlines", "x".repeat(129)])(
    "replaces unsafe request ID %j",
    (unsafeRequestId) => {
      const result = resolveRequestId(unsafeRequestId);

      expect(result).not.toBe(unsafeRequestId);
      expect(result).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("uses only the first header value", () => {
    expect(resolveRequestId(["first", "second"])).toBe("first");
  });
});
