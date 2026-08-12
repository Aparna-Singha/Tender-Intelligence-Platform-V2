import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import {
  metricRouteForRequest,
  unmatchedRouteLabel,
} from "../src/common/metric-routes.js";

function request(url: string, routeTemplate?: string): FastifyRequest {
  return {
    routeOptions: { url: routeTemplate },
    url,
  } as FastifyRequest;
}

describe("metricRouteForRequest", () => {
  it("uses registered parameterized route templates", () => {
    expect(
      metricRouteForRequest(
        request(
          "/tenders/8d9114e5-1111-4222-9333-000000000000/documents/123",
          "/tenders/:tenderId/documents/:documentId",
        ),
      ),
    ).toBe("/tenders/:tenderId/documents/:documentId");
  });

  it("does not expose UUIDs from matched parameterized requests", () => {
    const label = metricRouteForRequest(
      request(
        "/tenders/8d9114e5-1111-4222-9333-000000000000",
        "/tenders/:tenderId",
      ),
    );

    expect(label).toBe("/tenders/:tenderId");
    expect(label).not.toContain("8d9114e5");
  });

  it("does not expose numeric IDs from matched parameterized requests", () => {
    const label = metricRouteForRequest(
      request("/sessions/123/revoke", "/sessions/:sessionId/revoke"),
    );

    expect(label).toBe("/sessions/:sessionId/revoke");
    expect(label).not.toContain("123");
  });

  it("collapses arbitrary unmatched paths to a fixed label", () => {
    expect(metricRouteForRequest(request("/random-attacker-path-abc123"))).toBe(
      unmatchedRouteLabel,
    );
    expect(metricRouteForRequest(request("/foo/bar/custom-string"))).toBe(
      unmatchedRouteLabel,
    );
  });

  it("does not include query strings in route labels", () => {
    expect(
      metricRouteForRequest(
        request("/ready?token=secret&email=user@example.test", "/ready"),
      ),
    ).toBe("/ready");
    expect(
      metricRouteForRequest(
        request("/random?token=secret&email=user@example.test"),
      ),
    ).toBe(unmatchedRouteLabel);
  });
});
