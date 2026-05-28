export const KMS_GATE_APP_VERSION = "0.1.0";

export {
  ReleasePredicateEvaluator,
} from "./predicate/ReleasePredicateEvaluator";
export type {
  GrantReader,
  ReleasePredicateEvaluatorOptions,
  ReleasePredicateRequest,
} from "./predicate/ReleasePredicateEvaluator";
export {
  LocalKeyStore,
} from "./keys/LocalKeyStore";
export type {
  WrappedKeyMaterial,
} from "./keys/LocalKeyStore";
