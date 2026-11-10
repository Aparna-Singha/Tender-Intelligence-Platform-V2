import { describe, expect, it } from "vitest";
import {
  dateOnlyExpiryInstant,
  isDateOnlyExpired,
} from "../src/date-only-expiry.js";

describe("India date-only expiry", () => {
  const expiry = new Date("2026-11-07T00:00:00.000Z");
  it("remains valid until the next India calendar day", () => {
    expect(dateOnlyExpiryInstant(expiry).toISOString()).toBe(
      "2026-11-07T18:30:00.000Z",
    );
    expect(
      isDateOnlyExpired(expiry, new Date("2026-11-07T18:29:59.999Z")),
    ).toBe(false);
    expect(
      isDateOnlyExpired(expiry, new Date("2026-11-07T18:30:00.000Z")),
    ).toBe(true);
  });
});
