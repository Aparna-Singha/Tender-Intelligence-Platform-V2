#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const pnpmInvocation =
  process.env.npm_execpath === undefined
    ? {
        argsPrefix: [],
        command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      }
    : { argsPrefix: [process.env.npm_execpath], command: process.execPath };
const secretKeyPattern =
  /(PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|COOKIE|SIGNED_URL|API_KEY)/i;

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function redact(value) {
  return String(value)
    .replaceAll(
      /postgresql:\/\/([^:@/]+):([^@/]+)@/g,
      "postgresql://$1:<redacted>@",
    )
    .replaceAll(
      /(password|secret|token|api[_-]?key)=([^&\s]+)/gi,
      "$1=<redacted>",
    );
}

export function findPlaceholderKeys(env) {
  return Object.entries(env)
    .filter(([key, value]) => {
      if (!secretKeyPattern.test(key)) return false;
      return /^replace-with-|your-local-secret$/i.test(String(value));
    })
    .map(([key]) => key)
    .sort();
}

export function comparePostgresEnv(env) {
  if (
    env.DATABASE_URL === undefined ||
    env.POSTGRES_USER === undefined ||
    env.POSTGRES_PASSWORD === undefined ||
    env.POSTGRES_DB === undefined
  ) {
    return [];
  }
  const issues = [];
  try {
    const url = new URL(env.DATABASE_URL);
    if (decodeURIComponent(url.username) !== env.POSTGRES_USER) {
      issues.push("DATABASE_URL username differs from POSTGRES_USER.");
    }
    if (decodeURIComponent(url.password) !== env.POSTGRES_PASSWORD) {
      issues.push("DATABASE_URL password differs from POSTGRES_PASSWORD.");
    }
    if (decodeURIComponent(url.pathname.slice(1)) !== env.POSTGRES_DB) {
      issues.push("DATABASE_URL database differs from POSTGRES_DB.");
    }
  } catch {
    issues.push("DATABASE_URL could not be parsed as a PostgreSQL URL.");
  }
  return issues;
}

function statusLine(status, name, message) {
  return `[${status}] ${name}${message ? ` - ${redact(message)}` : ""}`;
}

async function tcpCheck(host, port, payload, expected) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 3_000 });
    let data = "";
    socket.on("connect", () => {
      if (payload === undefined) {
        socket.end();
        resolve();
      } else {
        socket.write(payload);
      }
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (expected.test(data)) {
        socket.end();
        resolve();
      }
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy(new Error("connection timed out"));
    });
    socket.on("close", () => {
      if (payload !== undefined && !expected.test(data)) {
        reject(new Error("unexpected response"));
      }
    });
  });
}

async function httpGet(url) {
  await new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 3_000 }, (response) => {
      response.resume();
      response.on("end", () => {
        response.statusCode && response.statusCode < 500
          ? resolve()
          : reject(new Error(`HTTP ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    request.on("timeout", () =>
      request.destroy(new Error("request timed out")),
    );
  });
}

async function commandAvailable(command, args) {
  await execFileAsync(command, args, { timeout: 5_000 });
}

async function checkPostgres(env) {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code === "28P01") return { ok: false, auth: true };
    return {
      ok: false,
      message: error instanceof Error ? error.message : "failed",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkMigrations(env) {
  try {
    await execFileAsync(
      pnpmInvocation.command,
      [
        ...pnpmInvocation.argsPrefix,
        "--filter",
        "@tender/database",
        "exec",
        "prisma",
        "migrate",
        "status",
      ],
      {
        env: { ...process.env, ...env },
        timeout: 30_000,
      },
    );
    return { ok: true };
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    return { ok: false, message: output.trim() || "migration status failed" };
  }
}

export async function runDoctor({
  cwd = process.cwd(),
  envFile = ".env",
  stdout = process.stdout,
} = {}) {
  const lines = [];
  const envPath = `${cwd}/${envFile}`;
  const env = existsSync(envPath)
    ? { ...process.env, ...parseDotEnv(readFileSync(envPath, "utf8")) }
    : { ...process.env };

  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "0",
    10,
  );
  lines.push(
    statusLine(
      nodeMajor >= 22 ? "PASS" : "FAIL",
      "Node",
      `detected ${process.versions.node}; requires >=22.18.0`,
    ),
  );

  const placeholders = findPlaceholderKeys(env);
  const pgMismatches = comparePostgresEnv(env);
  const required = ["DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "CLAMAV_HOST"];
  const missing = required.filter((key) => !env[key]);
  const envOk =
    existsSync(envPath) &&
    missing.length === 0 &&
    placeholders.length === 0 &&
    pgMismatches.length === 0;
  lines.push(
    statusLine(
      envOk ? "PASS" : "FAIL",
      "Environment",
      [
        !existsSync(envPath) ? ".env was not found" : undefined,
        missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
        placeholders.length > 0
          ? `replace placeholders for ${placeholders.join(", ")}`
          : undefined,
        ...pgMismatches,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  await commandAvailable(pnpmInvocation.command, [
    ...pnpmInvocation.argsPrefix,
    "--version",
  ])
    .then(() => lines.push(statusLine("PASS", "pnpm")))
    .catch(() => lines.push(statusLine("WARN", "pnpm", "pnpm is unavailable")));
  await commandAvailable("docker", ["compose", "version"])
    .then(() => lines.push(statusLine("PASS", "Docker Compose")))
    .catch(() =>
      lines.push(
        statusLine("WARN", "Docker Compose", "Docker Compose is unavailable"),
      ),
    );

  const postgres = env.DATABASE_URL
    ? await checkPostgres(env)
    : { ok: false, message: "DATABASE_URL is missing" };
  lines.push(
    postgres.ok
      ? statusLine("PASS", "PostgreSQL")
      : statusLine(
          "FAIL",
          "PostgreSQL",
          postgres.auth
            ? "configured credentials were rejected. Changing .env does not change credentials already initialized inside an existing local PostgreSQL Docker volume. A destructive local-development recovery such as `docker compose down -v` deletes local database/storage data and requires explicit human choice."
            : postgres.message,
        ),
  );

  if (env.REDIS_URL) {
    const redis = new URL(env.REDIS_URL);
    await tcpCheck(
      redis.hostname,
      Number(redis.port || 6379),
      "PING\r\n",
      /\+PONG/,
    )
      .then(() => lines.push(statusLine("PASS", "Redis")))
      .catch((error) => lines.push(statusLine("FAIL", "Redis", error.message)));
  }

  if (env.S3_ENDPOINT) {
    await httpGet(new URL("/minio/health/live", env.S3_ENDPOINT).toString())
      .then(() => lines.push(statusLine("PASS", "MinIO")))
      .catch((error) => lines.push(statusLine("FAIL", "MinIO", error.message)));
  }

  if (env.CLAMAV_HOST && env.CLAMAV_PORT) {
    await tcpCheck(env.CLAMAV_HOST, Number(env.CLAMAV_PORT), "zPING\0", /PONG/)
      .then(() => lines.push(statusLine("PASS", "ClamAV")))
      .catch((error) =>
        lines.push(statusLine("FAIL", "ClamAV", error.message)),
      );
  }

  const migrations = await checkMigrations(env);
  lines.push(
    migrations.ok
      ? statusLine("PASS", "Database migrations")
      : statusLine("FAIL", "Database migrations", migrations.message),
  );

  const failed = lines.some((line) => line.startsWith("[FAIL]"));
  lines.push(
    failed
      ? "Environment is not ready yet. See the checks above."
      : "Environment looks ready for local development.",
  );
  stdout.write(`${lines.join("\n")}\n`);
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runDoctor();
}
