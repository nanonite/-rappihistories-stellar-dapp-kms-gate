import { beforeAll, describe, expect, test } from "bun:test";
import type { AccessGrant, PredicateDenyReason } from "@medichain/domain";
import { LocalKeyStore } from "../keys/LocalKeyStore";
import { ReleaseHttpApi, type ReleaseAuditEvent } from "../http/ReleaseHttpApi";
import { RequesterRateLimiter } from "../http/RequesterRateLimiter";
import {
  type GrantReader,
  ReleasePredicateEvaluator,
} from "../predicate/ReleasePredicateEvaluator";

const nowSeconds = 1_700_000_000;
const releaseUrl = "http://kms-gate.test/v1/release";

let clinician: TestRequester;
let otherClinician: TestRequester;

beforeAll(async () => {
  clinician = await createRequester();
  otherClinician = await createRequester();
});

interface TestRequester {
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
}

const baseGrant = (): AccessGrant => ({
  grantId: "grant-1",
  record: {
    recordId: "record-1",
    patient: "patient-public-key",
    category: "condition",
    tier: "full_clinical_history",
    locator: {
      locator: "opaque://record-1",
      contentCommitment: "b4f77d5c0c17d4b91a55d9d4c8219e38",
    },
    createdAt: nowSeconds - 600,
  },
  grantee: clinician.publicKey,
  grantType: "normal",
  purpose: "treatment",
  scopeCategory: "condition",
  revealAt: nowSeconds - 1,
  expiresAt: nowSeconds + 300,
  revoked: false,
  vetoed: false,
});

describe("ReleaseHttpApi", () => {
  test("returns a wrapped key for an authenticated allowed release", async () => {
    const auditEvents: ReleaseAuditEvent[] = [];
    const api = releaseApiFor(baseGrant(), auditEvents);
    const response = await api.fetch(
      await releaseRequest({
        requester: clinician,
        grantId: "grant-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      wrappedKey: expect.stringMatching(/^local-stub:v1:[A-Za-z0-9_-]{43}$/),
    });
    expect(auditEvents).toEqual([
      {
        grantId: "grant-1",
        requester: clinician.publicKey,
        decision: "allow",
        reason: null,
        timestamp: nowSeconds,
      },
    ]);
  });

  const denyCases: readonly {
    readonly name: string;
    readonly grant: () => AccessGrant | null;
    readonly requester: () => TestRequester;
    readonly expectedReason: PredicateDenyReason;
  }[] = [
    {
      name: "no grant",
      grant: () => null,
      requester: () => clinician,
      expectedReason: "NO_GRANT",
    },
    {
      name: "wrong requester",
      grant: baseGrant,
      requester: () => otherClinician,
      expectedReason: "WRONG_REQUESTER",
    },
    {
      name: "revoked",
      grant: () => grantWith({ revoked: true }),
      requester: () => clinician,
      expectedReason: "REVOKED",
    },
    {
      name: "vetoed",
      grant: () => grantWith({ vetoed: true }),
      requester: () => clinician,
      expectedReason: "VETOED",
    },
    {
      name: "before reveal",
      grant: () => grantWith({ revealAt: nowSeconds + 1 }),
      requester: () => clinician,
      expectedReason: "BEFORE_REVEAL",
    },
    {
      name: "expired",
      grant: () => grantWith({ expiresAt: nowSeconds }),
      requester: () => clinician,
      expectedReason: "EXPIRED",
    },
  ];

  for (const denyCase of denyCases) {
    test(`returns HTTP 403 for predicate deny: ${denyCase.name}`, async () => {
      const auditEvents: ReleaseAuditEvent[] = [];
      const api = releaseApiFor(denyCase.grant(), auditEvents);
      const requester = denyCase.requester();
      const response = await api.fetch(
        await releaseRequest({
          requester,
          grantId: "grant-1",
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        denied: true,
        reason: denyCase.expectedReason,
      });
      expect(auditEvents).toEqual([
        {
          grantId: "grant-1",
          requester: requester.publicKey,
          decision: "deny",
          reason: denyCase.expectedReason,
          timestamp: nowSeconds,
        },
      ]);
    });
  }

  test("rejects an invalid requester signature", async () => {
    const auditEvents: ReleaseAuditEvent[] = [];
    const api = releaseApiFor(baseGrant(), auditEvents);
    const validBody = await signedReleaseBody({
      requester: clinician,
      grantId: "grant-1",
    });
    const response = await api.fetch(
      jsonRequest(releaseUrl, {
        ...validBody,
        requesterAuth: await signRelease("other-grant", clinician.privateKey),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      denied: true,
      reason: "UNAUTHORIZED",
    });
    expect(auditEvents[0]).toMatchObject({
      grantId: "grant-1",
      requester: clinician.publicKey,
      decision: "deny",
      reason: "UNAUTHORIZED",
    });
  });

  test("rate limits release requests by requester", async () => {
    const api = releaseApiFor(baseGrant(), [], {
      rateLimiter: new RequesterRateLimiter({
        maxRequestsPerWindow: 1,
        windowSeconds: 60,
      }),
    });

    const firstResponse = await api.fetch(
      await releaseRequest({
        requester: clinician,
        grantId: "grant-1",
      }),
    );
    const secondResponse = await api.fetch(
      await releaseRequest({
        requester: clinician,
        grantId: "grant-1",
      }),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    await expect(secondResponse.json()).resolves.toEqual({
      denied: true,
      reason: "RATE_LIMITED",
    });
  });

  test("validates method, path, and body shape", async () => {
    const api = releaseApiFor(baseGrant(), []);

    await expect(api.fetch(new Request(releaseUrl))).resolves.toMatchObject({
      status: 405,
    });
    await expect(
      api.fetch(new Request("http://kms-gate.test/not-release")),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      api.fetch(jsonRequest(releaseUrl, { grantId: "grant-1" })),
    ).resolves.toMatchObject({ status: 400 });
  });
});

function grantWith(overrides: Partial<AccessGrant>): AccessGrant {
  return {
    ...baseGrant(),
    ...overrides,
  };
}

function releaseApiFor(
  grant: AccessGrant | null,
  auditEvents: ReleaseAuditEvent[],
  options: { readonly rateLimiter?: RequesterRateLimiter } = {},
): ReleaseHttpApi {
  const grantReader: GrantReader = {
    async readGrant() {
      return grant;
    },
  };

  return new ReleaseHttpApi({
    evaluator: new ReleasePredicateEvaluator({
      grantReader,
      nowSeconds: () => nowSeconds,
    }),
    keyStore: new LocalKeyStore(),
    nowSeconds: () => nowSeconds,
    logger: (event) => auditEvents.push(event),
    rateLimiter: options.rateLimiter,
  });
}

async function releaseRequest(input: {
  readonly requester: TestRequester;
  readonly grantId: string;
}): Promise<Request> {
  return jsonRequest(releaseUrl, await signedReleaseBody(input));
}

async function signedReleaseBody(input: {
  readonly requester: TestRequester;
  readonly grantId: string;
}) {
  return {
    grantId: input.grantId,
    requester: input.requester.publicKey,
    requesterAuth: await signRelease(input.grantId, input.requester.privateKey),
    locator: "opaque://record-1",
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function createRequester(): Promise<TestRequester> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  return {
    publicKey: base64Url(new Uint8Array(publicKey)),
    privateKey: keyPair.privateKey,
  };
}

async function signRelease(
  grantId: string,
  privateKey: CryptoKey,
): Promise<string> {
  const messageHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`hcstellar:kms:v1:${grantId}`),
  );
  const signature = await crypto.subtle.sign("Ed25519", privateKey, messageHash);

  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
