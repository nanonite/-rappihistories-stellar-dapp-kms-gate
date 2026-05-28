import type {
  AccessGrant,
  ClinicalHistoryTier,
  GrantType,
  RecordCategory,
} from "@medichain/domain";
import type { GrantReader } from "../predicate/ReleasePredicateEvaluator.js";

export interface IndexerGrantReaderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

interface IndexerGrantResponse {
  readonly grant?: unknown;
}

export class IndexerGrantReader implements GrantReader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IndexerGrantReaderOptions) {
    this.baseUrl = new URL(options.baseUrl).toString().replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async readGrant(grantId: string): Promise<AccessGrant | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/grants/${encodeURIComponent(grantId)}`,
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `api-indexer grant lookup failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as IndexerGrantResponse;
    return toAccessGrant(payload.grant);
  }
}

function toAccessGrant(value: unknown): AccessGrant {
  const grant = requireRecord(value, "grant");
  const record = requireRecord(grant.record, "grant.record");
  const recordType = requireString(record.recordType, "grant.record.recordType");
  const commitment = requireString(record.commitment, "grant.record.commitment");
  const storageRef = requireString(record.storageRef, "grant.record.storageRef");

  return {
    grantId: requireString(grant.grantId, "grant.grantId"),
    record: {
      recordId: requireString(record.recordId, "grant.record.recordId"),
      patient: requireString(
        record.patientPseudonym,
        "grant.record.patientPseudonym",
      ),
      category: toRecordCategory(recordType),
      tier: toClinicalHistoryTier(requireString(record.tier, "grant.record.tier")),
      locator: {
        locatorType: "opaque",
        locator: storageRef,
        contentCommitment: commitment,
      },
      createdAt: toSeconds(record.indexedAt),
    },
    grantee: requireString(grant.grantee, "grant.grantee"),
    grantType: toGrantType(requireString(grant.grantType, "grant.grantType")),
    purpose: requireString(grant.purpose, "grant.purpose"),
    scopeCategory: toRecordCategory(
      requireString(grant.scopeCategory, "grant.scopeCategory"),
    ),
    revealAt: requireIntegerString(grant.revealAt, "grant.revealAt"),
    expiresAt: requireIntegerString(grant.expiresAt, "grant.expiresAt"),
    revoked: requireBoolean(grant.revoked, "grant.revoked"),
    vetoed: requireBoolean(grant.vetoed, "grant.vetoed"),
  };
}

function toClinicalHistoryTier(value: string): ClinicalHistoryTier {
  if (
    value === "offline_emergency_card" ||
    value === "online_emergency_bundle" ||
    value === "full_clinical_history"
  ) {
    return value;
  }

  throw new Error(`Unsupported clinical history tier: ${value}`);
}

function toGrantType(value: string): GrantType {
  if (
    value === "normal" ||
    value === "break_glass" ||
    value === "offline_emergency" ||
    value === "write"
  ) {
    return value;
  }

  throw new Error(`Unsupported grant type: ${value}`);
}

function toRecordCategory(value: string): RecordCategory {
  if (
    value === "allergy" ||
    value === "medication" ||
    value === "condition" ||
    value === "procedure" ||
    value === "lab" ||
    value === "imaging" ||
    value === "note" ||
    value === "immunization" ||
    value === "prescription" ||
    value === "behavioral_health" ||
    value === "reproductive_health" ||
    value === "substance_use"
  ) {
    return value;
  }

  throw new Error(`Unsupported record category: ${value}`);
}

function requireRecord(
  value: unknown,
  location: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${location} must be a non-empty string`);
  }

  return value;
}

function requireIntegerString(value: unknown, location: string): number {
  const rawValue = requireString(value, location);
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${location} must be an integer string`);
  }

  return parsed;
}

function requireBoolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${location} must be a boolean`);
  }

  return value;
}

function toSeconds(value: unknown): number {
  const rawValue = requireString(value, "grant.record.indexedAt");
  const milliseconds = Date.parse(rawValue);

  if (Number.isNaN(milliseconds)) {
    throw new Error("grant.record.indexedAt must be an ISO timestamp");
  }

  return Math.floor(milliseconds / 1_000);
}
