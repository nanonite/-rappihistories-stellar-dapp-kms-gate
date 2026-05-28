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
      decodeBase64Url(input.requester),
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
