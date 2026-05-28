import {
  evaluateReleasePredicate,
  type AccessGrant,
  type PredicateResult,
} from "@medichain/domain";

export interface GrantReader {
  readGrant(grantId: string): Promise<AccessGrant | null>;
}

export interface ReleasePredicateEvaluatorOptions {
  readonly grantReader: GrantReader;
  readonly nowSeconds?: () => number;
}

export interface ReleasePredicateRequest {
  readonly grantId: string;
  readonly requester: string;
  readonly nowSeconds?: number;
}

export class ReleasePredicateEvaluator {
  private readonly grantReader: GrantReader;
  private readonly nowSeconds: () => number;

  constructor(options: ReleasePredicateEvaluatorOptions) {
    this.grantReader = options.grantReader;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  async evaluate(request: ReleasePredicateRequest): Promise<PredicateResult> {
    const grant = await this.grantReader.readGrant(request.grantId);
    const nowSeconds = request.nowSeconds ?? this.nowSeconds();

    return evaluateReleasePredicate(grant, request.requester, nowSeconds);
  }
}
