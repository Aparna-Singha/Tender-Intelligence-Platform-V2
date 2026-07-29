import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: {
    readonly N: number;
    readonly maxmem: number;
    readonly p: number;
    readonly r: number;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error === null) resolve(derivedKey);
      else reject(error);
    });
  });
}
const SCRYPT_LOG_N = 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function privacyHash(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export class ScryptPasswordHasher {
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: 2 ** SCRYPT_LOG_N,
      maxmem: SCRYPT_MAX_MEMORY,
      p: SCRYPT_P,
      r: SCRYPT_R,
    });

    return [
      "scrypt",
      `ln=${SCRYPT_LOG_N},r=${SCRYPT_R},p=${SCRYPT_P}`,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  public async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split("$");
    if (parts.length !== 4 || parts[0] !== "scrypt") {
      return false;
    }
    const parameters = parts[1]?.match(/^ln=(\d+),r=(\d+),p=(\d+)$/);
    const saltPart = parts[2];
    const hashPart = parts[3];
    if (
      parameters === null ||
      parameters === undefined ||
      saltPart === undefined ||
      hashPart === undefined
    ) {
      return false;
    }
    const logN = Number(parameters[1]);
    const r = Number(parameters[2]);
    const p = Number(parameters[3]);
    if (logN !== SCRYPT_LOG_N || r !== SCRYPT_R || p !== SCRYPT_P) {
      return false;
    }

    try {
      const expected = Buffer.from(hashPart, "base64url");
      const actual = await scrypt(
        password,
        Buffer.from(saltPart, "base64url"),
        expected.length,
        {
          N: 2 ** logN,
          maxmem: SCRYPT_MAX_MEMORY,
          p,
          r,
        },
      );
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    } catch {
      return false;
    }
  }
}
