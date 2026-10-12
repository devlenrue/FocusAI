import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

/**
 * Uses Node's vetted memory-hard scrypt implementation with a unique random
 * salt. Argon2id can replace this behind the same narrow interface later if a
 * supported deployment dependency is selected.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derive(password, salt);
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [scheme, parameters, encodedSalt, encodedKey] = storedHash
    .split("$")
    .filter(Boolean);
  if (
    scheme !== "scrypt" ||
    parameters !== `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}` ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedKey, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
