# KMS Gate

The KMS gate releases wrapped key material only after a wallet-authenticated
request passes the shared release predicate from `@medichain/domain`.

## Append Write Grants

The Option A append path does not change the release predicate. A clinician
using `append_record` is authoring a new encrypted payload and supplying a new
locator plus commitment. The append call does not release existing ciphertext.

`GrantType: "write"` is therefore not a valid release input. KMS returns a
denial for write grants, and reads of appended entries still require a separate
normal, break-glass, or offline-emergency grant for the specific record id.
