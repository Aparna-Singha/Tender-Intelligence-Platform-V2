import { describe, expect, it } from "vitest";
import {
  selectSubmissionDeadline,
  type DeadlineField,
} from "../src/submission-deadline.js";

const source = (
  text: string,
  role: string,
  _createdAt: string,
  overrides: Partial<DeadlineField> = {},
): DeadlineField => ({
  normalizedTextValue: text,
  reviewState: "UNREVIEWED",
  findingState: "FOUND",
  citations: [
    {
      validationStatus: "VALID",
      tenderDocument: { role },
    },
  ],
  ...overrides,
});

describe("authoritative submission deadline", () => {
  const primary = source("21-08-2026 09:00:00", "PRIMARY", "2026-08-01");
  it.each([
    ["extension", "24-08-2026 09:00:00", "2026-08-24T03:30:00.000Z"],
    ["reduction", "19-08-2026 09:00:00", "2026-08-19T03:30:00.000Z"],
  ])("selects a later corrigendum %s", (_name, text, expected) => {
    expect(
      selectSubmissionDeadline([
        primary,
        source(text, "CORRIGENDUM", "2026-08-10"),
      ]).date?.toISOString(),
    ).toBe(expected);
  });
  it("refuses conflicting corrigenda even when one was uploaded later", () => {
    expect(
      selectSubmissionDeadline([
        primary,
        source("19-08-2026 09:00:00", "CORRIGENDUM", "2026-08-10"),
        source("20-08-2026 09:00:00", "CORRIGENDUM", "2026-08-11"),
      ]),
    ).toEqual({ date: null, text: null, conflicting: true });
  });
  it("lets an accepted review distinguish conflicting corrigenda", () => {
    expect(
      selectSubmissionDeadline([
        source("19-08-2026 09:00:00", "CORRIGENDUM", "2026-08-10", {
          reviewState: "ACCEPTED",
        }),
        source("20-08-2026 09:00:00", "CORRIGENDUM", "2026-08-11"),
      ]).date?.toISOString(),
    ).toBe("2026-08-19T03:30:00.000Z");
  });
  it("ignores rejected and invalid citations and has no invented date", () => {
    expect(
      selectSubmissionDeadline([
        source("19-08-2026 09:00:00", "CORRIGENDUM", "2026-08-10", {
          reviewState: "REJECTED",
        }),
        source("20-08-2026 09:00:00", "CORRIGENDUM", "2026-08-10", {
          citations: [],
        }),
      ]),
    ).toEqual({ date: null, text: null, conflicting: false });
  });
});
