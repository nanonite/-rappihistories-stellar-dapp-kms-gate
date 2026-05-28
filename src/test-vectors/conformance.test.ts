import { describe, expect, test } from "bun:test";
import {
  evaluateReleasePredicate,
  type AccessGrant,
  type PredicateResult,
} from "@medichain/domain";

const caller = "clinician-public-key";
const otherCaller = "other-clinician-public-key";
const nowSeconds = 1_700_000_000;

const baseGrant: AccessGrant = {
  grantId: "grant-valid",
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
  grantee: caller,
  grantType: "normal",
  purpose: "treatment",
  scopeCategory: "condition",
  revealAt: nowSeconds - 1,
  expiresAt: nowSeconds + 300,
  revoked: false,
  vetoed: false,
};

interface ConformanceVector {
  readonly id: number;
  readonly name: string;
  readonly grant: AccessGrant | null;
  readonly requester: string;
  readonly nowSeconds: number;
  readonly expected: PredicateResult;
}

function grantWith(
  id: string,
  overrides: Partial<AccessGrant> = {},
): AccessGrant {
  return {
    ...baseGrant,
    ...overrides,
    grantId: id,
  };
}

const conformanceVectors: readonly ConformanceVector[] = [
  {
    id: 1,
    name: "no grant",
    grant: null,
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "NO_GRANT" },
  },
  {
    id: 2,
    name: "wrong requester",
    grant: grantWith("grant-wrong-requester"),
    requester: otherCaller,
    nowSeconds,
    expected: { allowed: false, reason: "WRONG_REQUESTER" },
  },
  {
    id: 3,
    name: "revoked",
    grant: grantWith("grant-revoked", { revoked: true }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "REVOKED" },
  },
  {
    id: 4,
    name: "vetoed",
    grant: grantWith("grant-vetoed", { vetoed: true }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "VETOED" },
  },
  {
    id: 5,
    name: "before reveal",
    grant: grantWith("grant-before-reveal", { revealAt: nowSeconds + 1 }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "BEFORE_REVEAL" },
  },
  {
    id: 6,
    name: "expires at boundary",
    grant: grantWith("grant-expiry-boundary", { expiresAt: nowSeconds }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "EXPIRED" },
  },
  {
    id: 7,
    name: "past expiry",
    grant: grantWith("grant-expired", { expiresAt: nowSeconds - 1 }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "EXPIRED" },
  },
  {
    id: 8,
    name: "valid grant with immediate reveal",
    grant: grantWith("grant-immediate-reveal", { revealAt: 0 }),
    requester: caller,
    nowSeconds,
    expected: { allowed: true },
  },
  {
    id: 9,
    name: "valid grant exactly at reveal",
    grant: grantWith("grant-at-reveal", { revealAt: nowSeconds }),
    requester: caller,
    nowSeconds,
    expected: { allowed: true },
  },
  {
    id: 10,
    name: "revoked and vetoed checks revocation first",
    grant: grantWith("grant-revoked-and-vetoed", {
      revoked: true,
      vetoed: true,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "REVOKED" },
  },
  {
    id: 11,
    name: "break-glass patient veto during wait",
    grant: grantWith("grant-break-glass-vetoed", {
      grantType: "break_glass",
      revealAt: nowSeconds + 60,
      vetoed: true,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "VETOED" },
  },
  {
    id: 12,
    name: "break-glass past reveal without veto",
    grant: grantWith("grant-break-glass-allowed", {
      grantType: "break_glass",
      revealAt: nowSeconds - 60,
      vetoed: false,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: true },
  },
  {
    id: 13,
    name: "normal grant immediate reveal",
    grant: grantWith("grant-normal-immediate", {
      grantType: "normal",
      revealAt: 0,
      revoked: false,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: true },
  },
  {
    id: 14,
    name: "previously allowed grant is rechecked after expiry",
    grant: grantWith("grant-expired-after-allow", {
      revealAt: nowSeconds - 600,
      expiresAt: nowSeconds,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "EXPIRED" },
  },
  {
    id: 15,
    name: "simulated request access never committed",
    grant: null,
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "NO_GRANT" },
  },
  {
    id: 16,
    name: "write grant cannot release ciphertext",
    grant: grantWith("grant-write-not-releasable", {
      grantType: "write",
      revealAt: 0,
    }),
    requester: caller,
    nowSeconds,
    expected: { allowed: false, reason: "WRITE_GRANT_NOT_RELEASABLE" },
  },
];

describe("KMS release predicate conformance", () => {
  test("covers the complete MVP truth table", () => {
    expect(conformanceVectors).toHaveLength(16);
  });

  for (const vector of conformanceVectors) {
    test(`${vector.id}. ${vector.name}`, () => {
      expect(
        evaluateReleasePredicate(
          vector.grant,
          vector.requester,
          vector.nowSeconds,
        ),
      ).toEqual(vector.expected);
    });
  }
});
