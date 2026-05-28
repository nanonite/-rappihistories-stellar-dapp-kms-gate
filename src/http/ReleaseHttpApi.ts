import type { PredicateDenyReason } from "@medichain/domain";
import type { LocalKeyStore } from "../keys/LocalKeyStore.js";
import type { ReleasePredicateEvaluator } from "../predicate/ReleasePredicateEvaluator.js";
import {
  Ed25519RequesterAuthVerifier,
  type RequesterAuthVerifier,
} from "./ReleaseAuth.js";
import { RequesterRateLimiter } from "./RequesterRateLimiter.js";

export interface ReleaseHttpApiOptions {
  readonly evaluator: ReleasePredicateEvaluator;
  readonly keyStore: Pick<LocalKeyStore, "getWrappedKey">;
  readonly authVerifier?: RequesterAuthVerifier;
  readonly rateLimiter?: RequesterRateLimiter;
  readonly nowSeconds?: () => number;
  readonly logger?: ReleaseAuditLogger;
}

export interface ReleaseRequestBody {
  readonly grantId: string;
  readonly requester: string;
  readonly requesterAuth: string;
  readonly locator: string;
}

export type ReleaseAuditDecision = "allow" | "deny";

export interface ReleaseAuditEvent {
  readonly grantId: string;
  readonly requester: string;
  readonly decision: ReleaseAuditDecision;
  readonly reason: string | null;
  readonly timestamp: number;
}

export type ReleaseAuditLogger = (event: ReleaseAuditEvent) => void;

export class ReleaseHttpApi {
  private readonly evaluator: ReleasePredicateEvaluator;
  private readonly keyStore: Pick<LocalKeyStore, "getWrappedKey">;
  private readonly authVerifier: RequesterAuthVerifier;
  private readonly rateLimiter: RequesterRateLimiter;
  private readonly nowSeconds: () => number;
  private readonly logger: ReleaseAuditLogger;

  constructor(options: ReleaseHttpApiOptions) {
    this.evaluator = options.evaluator;
    this.keyStore = options.keyStore;
    this.authVerifier =
      options.authVerifier ?? new Ed25519RequesterAuthVerifier();
    this.rateLimiter = options.rateLimiter ?? new RequesterRateLimiter();
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
    this.logger =
      options.logger ??
      ((event) => {
        console.info(JSON.stringify(event));
      });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/v1/release") {
      return jsonResponse({ error: "not_found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const body = await parseReleaseRequest(request);
    if (body === null) {
      return jsonResponse({ error: "invalid_release_request" }, 400);
    }

    const timestamp = this.nowSeconds();

    if (!this.rateLimiter.tryConsume(body.requester, timestamp)) {
      this.logRelease(body, "deny", "RATE_LIMITED", timestamp);
      return jsonResponse({ denied: true, reason: "RATE_LIMITED" }, 429);
    }

    const authenticated = await this.verifyRequester(body);
    if (!authenticated) {
      this.logRelease(body, "deny", "UNAUTHORIZED", timestamp);
      return jsonResponse({ denied: true, reason: "UNAUTHORIZED" }, 401);
    }

    const predicate = await this.evaluator.evaluate({
      grantId: body.grantId,
      requester: body.requester,
      nowSeconds: timestamp,
    });

    if (!predicate.allowed) {
      this.logRelease(body, "deny", predicate.reason, timestamp);
      return jsonResponse(
        { denied: true, reason: predicate.reason },
        403,
      );
    }

    const keyMaterial = await this.keyStore.getWrappedKey(body.grantId);
    this.logRelease(body, "allow", null, timestamp);

    return jsonResponse({ wrappedKey: keyMaterial.wrappedKey }, 200);
  }

  private async verifyRequester(body: ReleaseRequestBody): Promise<boolean> {
    try {
      return await this.authVerifier.verifyReleaseRequest({
        grantId: body.grantId,
        requester: body.requester,
        requesterAuth: body.requesterAuth,
      });
    } catch {
      return false;
    }
  }

  private logRelease(
    body: ReleaseRequestBody,
    decision: ReleaseAuditDecision,
    reason: PredicateDenyReason | "RATE_LIMITED" | "UNAUTHORIZED" | null,
    timestamp: number,
  ): void {
    this.logger({
      grantId: body.grantId,
      requester: body.requester,
      decision,
      reason,
      timestamp,
    });
  }
}

async function parseReleaseRequest(
  request: Request,
): Promise<ReleaseRequestBody | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isObject(body)) {
    return null;
  }

  const grantId = body["grantId"];
  const requester = body["requester"];
  const requesterAuth = body["requesterAuth"];
  const locator = body["locator"];

  if (
    typeof grantId !== "string" ||
    grantId.length === 0 ||
    typeof requester !== "string" ||
    requester.length === 0 ||
    typeof requesterAuth !== "string" ||
    requesterAuth.length === 0 ||
    typeof locator !== "string" ||
    locator.length === 0
  ) {
    return null;
  }

  return {
    grantId,
    requester,
    requesterAuth,
    locator,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
