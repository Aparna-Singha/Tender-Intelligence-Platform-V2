import { describe, expect, it } from "vitest";
import Fastify from "fastify";

import {
  beginTenderDetailTiming,
  finishTenderDetailTiming,
  markTenderDetailHandlerDone,
  markTenderDetailOnSend,
  measureTenderDetailStage,
  tenderDetailRoute,
  tenderDetailStageRecorder,
  type TenderDetailTimingSummary,
} from "../src/common/tender-detail-timing.js";

const request = (route = tenderDetailRoute): never =>
  ({ method: "GET", routeOptions: { url: route } }) as never;

describe("opt-in tender detail diagnostics", () => {
  it("does not collect when disabled or on a different route", () => {
    const disabled = request();
    beginTenderDetailTiming(disabled, false, 0n);
    expect(tenderDetailStageRecorder(disabled)).toBeUndefined();
    expect(finishTenderDetailTiming(disabled, 100_000_000n)).toBeNull();

    const unrelated = request("/organisations/:organisationId/tenders");
    beginTenderDetailTiming(unrelated, true, 0n);
    expect(tenderDetailStageRecorder(unrelated)).toBeUndefined();
  });

  it("retains only fixed numeric stage fields and accounts for response time", () => {
    const selected = request();
    beginTenderDetailTiming(selected, true, 0n);
    const record = tenderDetailStageRecorder(selected);
    expect(record).toBeDefined();
    record!("session_authentication", 10);
    record!("organisation_authorization", 20);
    record!("secret-token" as never, 5);
    markTenderDetailHandlerDone(selected, 80_000_000n);
    markTenderDetailOnSend(selected, 90_000_000n);
    expect(finishTenderDetailTiming(selected, 100_000_000n)).toEqual({
      durationMs: 100,
      stagesMs: {
        session_authentication: 10,
        organisation_authorization: 20,
        post_handler_pre_send: 10,
        send_to_response: 10,
        unattributed: 50,
      },
    });
    expect(finishTenderDetailTiming(selected, 110_000_000n)).toBeNull();
  });

  it("records a failed dependency without changing its rejection", async () => {
    const selected = request();
    beginTenderDetailTiming(selected, true);
    const failure = new Error("synthetic failure");
    await expect(
      measureTenderDetailStage(
        tenderDetailStageRecorder(selected),
        "tender_primary_query",
        () => Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
    expect(
      finishTenderDetailTiming(selected)?.stagesMs.tender_primary_query,
    ).toBeGreaterThanOrEqual(0);
  });

  it("keeps concurrent request timings separate", () => {
    const first = request();
    const second = request();
    beginTenderDetailTiming(first, true, 0n);
    beginTenderDetailTiming(second, true, 0n);
    tenderDetailStageRecorder(first)!("session_authentication", 10);
    tenderDetailStageRecorder(second)!("session_authentication", 40);
    expect(
      finishTenderDetailTiming(first, 100_000_000n)?.stagesMs
        .session_authentication,
    ).toBe(10);
    expect(
      finishTenderDetailTiming(second, 100_000_000n)?.stagesMs
        .session_authentication,
    ).toBe(40);
  });

  it("sees the registered route and response hooks in Fastify", async () => {
    const server = Fastify();
    let recordedRoute = false;
    const observed: { current: TenderDetailTimingSummary | null } = {
      current: null,
    };
    server.addHook("onRequest", (incoming, _reply, done) => {
      beginTenderDetailTiming(incoming, true);
      recordedRoute = tenderDetailStageRecorder(incoming) !== undefined;
      done();
    });
    server.addHook("onSend", (incoming, _reply, payload, done) => {
      markTenderDetailOnSend(incoming);
      done(null, payload);
    });
    server.addHook("onResponse", (incoming, _reply, done) => {
      observed.current = finishTenderDetailTiming(incoming);
      done();
    });
    server.get(tenderDetailRoute, (incoming) => {
      markTenderDetailHandlerDone(incoming);
      return { ok: true };
    });
    try {
      const response = await server.inject({
        method: "GET",
        url: "/organisations/org-a/tenders/tender-a",
      });
      expect(response.statusCode).toBe(200);
      expect(recordedRoute).toBe(true);
      expect(
        observed.current?.stagesMs.post_handler_pre_send,
      ).toBeGreaterThanOrEqual(0);
      expect(
        observed.current?.stagesMs.send_to_response,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await server.close();
    }
  });
});
