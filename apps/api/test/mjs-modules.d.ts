declare module "*.mjs" {
  export function parseDotEnv(text: string): Record<string, string>;
  export function redact(value: unknown): string;
  export function findPlaceholderKeys(env: Record<string, string>): string[];
  export function comparePostgresEnv(env: Record<string, string>): string[];
}
