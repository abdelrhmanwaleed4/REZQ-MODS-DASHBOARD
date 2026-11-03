import { describe, expect, it } from "vitest";
import { matchesAutoMod } from "../server/advancedOps";
import { encryptLinkSecret, decryptLinkSecret } from "../server/accountLinks";
import { CRITICAL_RANK_PERMISSIONS } from "../server/routers";

describe("REZK V3 privacy and security regression tests", () => {
  it("detects plain HTTP and HTTPS links", () => {
    expect(matchesAutoMod("link", "", "visit https://example.com" )).toBe(true);
    expect(matchesAutoMod("link", "", "hello team")).toBe(false);
  });
  it("detects configured prohibited words case-insensitively", () => {
    expect(matchesAutoMod("word", "Spam", "SPAM is not allowed")).toBe(true);
    expect(matchesAutoMod("word", "", "hello")).toBe(false);
  });
  it("detects repeated characters and filters long payloads", () => {
    expect(matchesAutoMod("flood", "", "aaaaaaaaaaa")).toBe(true);
    expect(matchesAutoMod("flood", "", "one two three")).toBe(false);
    expect(matchesAutoMod("word", "hi", "x".repeat(4001))).toBe(false);
  });
  it("encrypts linked tokens with authenticated ciphertext", () => {
    const old = process.env.LINK_TOKEN_ENCRYPTION_KEY;
    process.env.LINK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 0x54).toString("base64");
    try {
      const c1 = encryptLinkSecret("test-token-for-unit-test");
      const c2 = encryptLinkSecret("test-token-for-unit-test");
      expect(c1).not.toEqual(c2);
      expect(c1).not.toContain("test-token-for-unit-test");
      expect(decryptLinkSecret(c1)).toBe("test-token-for-unit-test");
      const parts = c1.split(".");
      parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
      expect(() => decryptLinkSecret(parts.join("."))).toThrow();
    } finally { if (old === undefined) delete process.env.LINK_TOKEN_ENCRYPTION_KEY; else process.env.LINK_TOKEN_ENCRYPTION_KEY = old; }
  });
  it("flags power-granting rank permissions for second-admin approval", () => {
    for (const p of ["manageRanks", "manageUsers", "manageDiscord", "deleteVoiceRooms", "manageAutoMod", "manageRewards"]) {
      expect(CRITICAL_RANK_PERMISSIONS.has(p)).toBe(true);
    }
    expect(CRITICAL_RANK_PERMISSIONS.has("manageAttendance")).toBe(false);
  });
});
