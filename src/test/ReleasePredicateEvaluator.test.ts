import { describe, expect, test } from "bun:test";
import type { AccessGrant, PredicateDenyReason } from "@medichain/domain";
import {
  type GrantReader,
  ReleasePredicateEvaluator,
} from "../predicate/ReleasePredicateEvaluator";

const caller = "clinician-public-key";
const nowSeconds = 1_700_000_000;

const baseGrant: AccessGrant = {
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
  grantee: caller,
  grantType: "normal",
  purpose: "treatment",
  scopeCategory: "condition",
  revealAt: nowSeconds - 1,
  expiresAt: nowSeconds + 300,
  revoked: false,
  vetoed: false,
};

interface DenyCase {
  readonly name: string;
  readonly grant: AccessGrant | null;
  readonly requester: string;
  readonly expectedReason: PredicateDenyReason;
}

function grantWith(overrides: Partial<AccessGrant>): AccessGrant {
  return {
    ...baseGrant,
    ...overrides,
  };
}

function evaluatorFor(grant: AccessGrant | null): ReleasePredicateEvaluator {
  const grantReader: GrantReader = {
    async readGrant() {
      return grant;
    },
  };

  return new ReleasePredicateEvaluator({
    grantReader,
    nowSeconds: () => nowSeconds,
  });
}

describe("ReleasePredicateEvaluator", () => {
  const denyCases: readonly DenyCase[] = [
    {
      name: "no grant",
      grant: null,
      requester: caller,
      expectedReason: "NO_GRANT",
    },
    {
      name: "wrong requester",
      grant: baseGrant,
      requester: "other-clinician-public-key",
      expectedReason: "WRONG_REQUESTER",
    },
    {
      name: "revoked",
      grant: grantWith({ revoked: true }),
      requester: caller,
      expectedReason: "REVOKED",
    },
    {
      name: "vetoed",
      grant: grantWith({ vetoed: true }),
      requester: caller,
      expectedReason: "VETOED",
    },
    {
      name: "before reveal",
      grant: grantWith({ revealAt: nowSeconds + 1 }),
      requester: caller,
      expectedReason: "BEFORE_REVEAL",
    },
    {
      name: "expires at boundary",
      grant: grantWith({ expiresAt: nowSeconds }),
      requester: caller,
      expectedReason: "EXPIRED",
    },
    {
      name: "past expiry",
      grant: grantWith({ expiresAt: nowSeconds - 1 }),
      requester: caller,
      expectedReason: "EXPIRED",
    },
    {
      name: "revoked and vetoed checks revocation first",
      grant: grantWith({ revoked: true, vetoed: true }),
      requester: caller,
      expectedReason: "REVOKED",
    },
  ];

  for (const denyCase of denyCases) {
    test(`denies ${denyCase.name}`, async () => {
      await expect(
        evaluatorFor(denyCase.grant).evaluate({
          grantId: "grant-1",
          requester: denyCase.requester,
        }),
      ).resolves.toEqual({
        allowed: false,
        reason: denyCase.expectedReason,
      });
    });
  }

  test("allows a matching active grant", async () => {
    await expect(
      evaluatorFor(baseGrant).evaluate({
        grantId: "grant-1",
        requester: caller,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  test("uses an explicit request timestamp when supplied", async () => {
    await expect(
      evaluatorFor(grantWith({ revealAt: nowSeconds + 30 })).evaluate({
        grantId: "grant-1",
        requester: caller,
        nowSeconds: nowSeconds + 30,
      }),
    ).resolves.toEqual({ allowed: true });
  });
});
