import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { computePerformance } from "./portalFeatures";
import { base32, validateTotp } from "./adminMfa";
import { verifyKickSignature } from "./kickEvents";
import { canManageDelegatedRank } from "./permissions";

describe("new staff features security and scoring", () => {
  it("caps the score and penalizes strikes", () => {
    expect(computePerformance({ verifiedMinutes: 1000, points: 1000, warnings: 0, strikes: 0, targetMinutes: 180, pointTarget: 150 }).total).toBe(100);
    expect(computePerformance({ verifiedMinutes: 180, points: 150, warnings: 1, strikes: 1, targetMinutes: 180, pointTarget: 150 }).total).toBe(77);
  });
  it("doesn't allow voice deletion without delegated permission", () => {
    expect(canManageDelegatedRank(["createVoiceRooms"], ["deleteVoiceRooms"])).toBe(false);
    expect(canManageDelegatedRank(["deleteVoiceRooms"], ["deleteVoiceRooms"])).toBe(true);
  });
  it("matches RFC TOTP 6-digit test vector", () => {
    expect(base32(Buffer.from("12345678901234567890"))).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(validateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000)).toBe(true);
    expect(validateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "000000", 59_000)).toBe(false);
  });
  it("verifies official webhook signing format", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const messageId = "01KICKTESTREPLAY123", timestamp = "2026-11-03T15:00:00.000Z";
    const body = Buffer.from('{"is_live":true}');
    const raw = Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), body]);
    const signature = sign("RSA-SHA256", raw, privateKey).toString("base64");
    expect(verifyKickSignature(messageId, timestamp, body, signature, pem)).toBe(true);
    expect(verifyKickSignature(messageId, timestamp, Buffer.from('{"is_live":false}'), signature, pem)).toBe(false);
  });
});
