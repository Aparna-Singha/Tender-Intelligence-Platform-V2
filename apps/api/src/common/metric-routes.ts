import type { FastifyRequest } from "fastify";

export const unmatchedRouteLabel = "__unmatched__";

export function metricRouteForRequest(request: FastifyRequest): string {
  return request.routeOptions.url ?? unmatchedRouteLabel;
}
