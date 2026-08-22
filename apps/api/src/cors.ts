import type { ApiEnvironment } from "@tender/config";

export const CORS_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export function corsOptions(environment: ApiEnvironment): {
  credentials: true;
  methods: string[];
  origin: string;
} {
  return {
    credentials: true,
    methods: [...CORS_METHODS],
    origin: environment.WEB_ORIGIN,
  };
}
