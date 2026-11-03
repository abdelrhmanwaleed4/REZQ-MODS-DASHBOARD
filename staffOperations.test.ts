import { describe, it, expect } from "vitest";
import { PERMISSION_IDS, canManageDelegatedRank, parsePermissions } from "./permissions";
import { promotionForPoints, reportingWindow, validatedDateRange } from "./moderation";

describe("delegated rank permissions", () => {
  it("blocks assigning a more privileged existing role", () => {
    expect(canManageDelegatedRank(["manageRanks"], ["manageRanks", "manageUsers"])).toBe(false);
  });
  it("permits managing only an equal-or-lower rank", () => {
    expect(canManageDelegatedRank(["manageRanks", "managePoints"], ["managePoints"])).toBe(true);
  });
  it("blocks granting report access without owning that permission", () => {
    expect(canManageDelegatedRank(["manageRanks"], ["viewReports"])).toBe(false);
  });
  it("parses only known permissions and ignores duplicates", () => {
    expect(parsePermissions(JSON.stringify(["manageLeaves", "manageLeaves", "unknown"])) ).toEqual(["manageLeaves"]);
    expect(PERMISSION_IDS).toContain("manageDiscipline");
  });
});

describe("staff operations boundaries", () => {
  it("computes all three promotion thresholds", () => {
    expect(promotionForPoints(149)).toMatchObject({ title: "Member", remaining: 1 });
    expect(promotionForPoints(150)).toMatchObject({ title: "Elite Staff", remaining: 250 });
    expect(promotionForPoints(400)).toMatchObject({ title: "Sub-Leader", remaining: 400 });
    expect(promotionForPoints(800)).toMatchObject({ title: "قيادة عليا", remaining: 0 });
  });
  it("rejects malformed dates, reversed ranges and multi-day excuses", () => {
    expect(() => validatedDateRange("2026-02-30", "2026-02-30", "excuse")).toThrow();
    expect(() => validatedDateRange("2026-11-09", "2026-11-01", "leave")).toThrow();
    expect(() => validatedDateRange("2026-11-01", "2026-11-02", "excuse")).toThrow();
    expect(validatedDateRange("2026-11-01", "2026-11-02", "leave")).toBe(2);
  });
  it("uses Qatar-local Monday as the start of a weekly report", () => {
    const report = reportingWindow("week", new Date("2026-11-03T12:00:00Z"));
    expect(report.start.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(report.end.toISOString()).toBe("2026-11-08T21:00:00.000Z");
  });
  it("supports prior month reports across year boundaries", () => {
    const report = reportingWindow("month", new Date("2026-01-03T12:00:00Z"), 1);
    expect(report.label).toBe("2025-12-01 / 2025-12-31");
  });
});
