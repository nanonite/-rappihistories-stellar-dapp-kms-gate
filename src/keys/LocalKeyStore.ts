const AES_256_KEY_BYTES = 32;
const HASH_OFFSET_BASIS = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

export interface WrappedKeyMaterial {
  readonly grantId: string;
  readonly algorithm: "AES-256-GCM";
  readonly wrappedKey: string;
}

export class LocalKeyStore {
  async getWrappedKey(grantId: string): Promise<WrappedKeyMaterial> {
    if (grantId.length === 0) {
      throw new Error("grantId is required");
    }

    // Local-only KMS stub. Lit Protocol or equivalent production wrapping
    // replaces this deterministic material in a later phase.
    return {
      grantId,
      algorithm: "AES-256-GCM",
      wrappedKey: `local-stub:v1:${base64Url(deriveKeyBytes(grantId))}`,
    };
  }
}

function deriveKeyBytes(grantId: string): Uint8Array {
  const keyBytes = new Uint8Array(AES_256_KEY_BYTES);

  for (let offset = 0; offset < AES_256_KEY_BYTES; offset += 4) {
    const hash = fnv1a32(`${grantId}:${offset / 4}`);

    keyBytes[offset] = hash >>> 24;
    keyBytes[offset + 1] = hash >>> 16;
    keyBytes[offset + 2] = hash >>> 8;
    keyBytes[offset + 3] = hash;
  }

  return keyBytes;
}

function fnv1a32(input: string): number {
  let hash = HASH_OFFSET_BASIS;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }

  return hash >>> 0;
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const bits =
      (first << 16) | ((hasSecond ? second : 0) << 8) | (hasThird ? third : 0);

    output += alphabet[(bits >>> 18) & 0x3f];
    output += alphabet[(bits >>> 12) & 0x3f];

    if (hasSecond) {
      output += alphabet[(bits >>> 6) & 0x3f];
    }

    if (hasThird) {
      output += alphabet[bits & 0x3f];
    }
  }

  return output;
}
