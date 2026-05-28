const RELEASE_AUTH_DOMAIN = "hcstellar:kms:v1:";

export interface RequesterAuthVerifier {
  verifyReleaseRequest(input: ReleaseAuthInput): Promise<boolean>;
}

export interface ReleaseAuthInput {
  readonly grantId: string;
  readonly requester: string;
  readonly requesterAuth: string;
}

export class Ed25519RequesterAuthVerifier implements RequesterAuthVerifier {
  async verifyReleaseRequest(input: ReleaseAuthInput): Promise<boolean> {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      decodeRequesterPublicKey(input.requester),
      "Ed25519",
      false,
      ["verify"],
    );
    const messageHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${RELEASE_AUTH_DOMAIN}${input.grantId}`),
    );

    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
      decodeBase64Url(input.requesterAuth),
      messageHash,
    );
  }
}

function decodeRequesterPublicKey(value: string): ArrayBuffer {
  if (/^G[A-Z2-7]{55}$/.test(value)) {
    return decodeStellarPublicKey(value);
  }

  return decodeBase64Url(value);
}

function decodeStellarPublicKey(publicKey: string): ArrayBuffer {
  const decoded = base32Decode(publicKey);
  const versionByte = decoded[0];
  const payload = decoded.slice(1, 33);

  if (versionByte !== 0x30 || payload.length !== 32) {
    throw new Error("Invalid Stellar public key");
  }

  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  );
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const decoded = atob(padded);
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return buffer;
}

function base32Decode(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of value.replace(/=+$/g, "")) {
    const index = alphabet.indexOf(char.toUpperCase());

    if (index < 0) {
      throw new Error("Invalid base32 character");
    }

    bits = (bits << 5) | index;
    bitCount += 5;

    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }

  return Uint8Array.from(bytes);
}
