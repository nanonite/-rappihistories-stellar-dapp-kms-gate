import { describe, expect, test } from "bun:test";
import { LocalKeyStore } from "../keys/LocalKeyStore";

describe("LocalKeyStore", () => {
  test("returns deterministic wrapped AES-256 key material for a grant", async () => {
    const keyStore = new LocalKeyStore();

    const first = await keyStore.getWrappedKey("grant-1");
    const second = await keyStore.getWrappedKey("grant-1");

    expect(first).toEqual(second);
    expect(first).toEqual({
      grantId: "grant-1",
      algorithm: "AES-256-GCM",
      wrappedKey: expect.stringMatching(/^local-stub:v1:[A-Za-z0-9_-]{43}$/),
    });
  });

  test("uses the grant id when deriving stub material", async () => {
    const keyStore = new LocalKeyStore();

    const first = await keyStore.getWrappedKey("grant-1");
    const second = await keyStore.getWrappedKey("grant-2");

    expect(first.wrappedKey).not.toEqual(second.wrappedKey);
  });

  test("requires a grant id", async () => {
    await expect(new LocalKeyStore().getWrappedKey("")).rejects.toThrow(
      "grantId is required",
    );
  });
});
