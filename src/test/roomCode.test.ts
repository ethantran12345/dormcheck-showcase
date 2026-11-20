import { describe, expect, it } from "vitest";
import { computeLeaveBy, parseRoomCode } from "@/lib/schedule/roomCode";

const ABBRS = ["CL", "OEH", "ALLEN", "SCAIF", "BENDM", "SUTHD", "BST3", "CLAPP"];

describe("parseRoomCode", () => {
  it("parses a simple code", () => {
    expect(parseRoomCode("CL0306", ABBRS)).toEqual({
      buildingAbbr: "CL",
      room: "0306",
    });
  });

  it("parses rooms that start digit-then-letter", () => {
    expect(parseRoomCode("CL0G16", ABBRS)).toEqual({
      buildingAbbr: "CL",
      room: "0G16",
    });
  });

  it("prefers the longest matching abbreviation", () => {
    // CLAPP0123 must match CLAPP, not CL with room 'APP0123'
    expect(parseRoomCode("CLAPP0123", ABBRS)).toEqual({
      buildingAbbr: "CLAPP",
      room: "0123",
    });
  });

  it("handles alphanumeric abbreviations", () => {
    expect(parseRoomCode("BST3456", ABBRS)).toEqual({
      buildingAbbr: "BST3",
      room: "456",
    });
  });

  it("is case-insensitive and trims", () => {
    expect(parseRoomCode(" oeh0316 ", ABBRS)).toEqual({
      buildingAbbr: "OEH",
      room: "0316",
    });
  });

  it("returns null for unknown buildings or empty input", () => {
    expect(parseRoomCode("ZZZZ0101", ABBRS)).toBeNull();
    expect(parseRoomCode("", ABBRS)).toBeNull();
  });
});

describe("computeLeaveBy", () => {
  it("subtracts walk time and default 5 min buffer", () => {
    // 10:00 class, 841s walk (rounded up to 15 min) -> leave by 09:40
    expect(computeLeaveBy("10:00", 841)).toBe("09:40");
  });

  it("accepts HH:MM:SS and custom buffer", () => {
    expect(computeLeaveBy("09:00:00", 600, 10)).toBe("08:40");
  });

  it("wraps across midnight", () => {
    expect(computeLeaveBy("00:10", 600)).toBe("23:55");
  });
});

import { rankSection } from "@/lib/schedule/searchRank";

describe("rankSection", () => {
  const chem = { subject: "CHEM", catalog_number: "0110", title: "GENERAL CHEMISTRY 1", title_display: "General Chemistry 1" };
  const bioeng = { subject: "BIOENG", catalog_number: "2411", title: "CHEMICAL ENGINEERING X", title_display: "Chemical Engineering X" };
  const biosc = { subject: "BIOSC", catalog_number: "1000", title: "BIOCHEMISTRY", title_display: "Biochemistry" };

  it("ranks subject-code prefix above title matches", () => {
    expect(rankSection(chem, "Chem")).toBe(0);
    expect(rankSection(bioeng, "Chem")).toBe(2); // title starts with "Chemical"
    expect(rankSection(biosc, "Chem")).toBe(3); // "bioCHEMistry" contains
  });

  it("matches full course codes", () => {
    expect(rankSection(chem, "CHEM 01")).toBe(0);
  });

  it("ranks catalog-number prefix", () => {
    expect(rankSection(bioeng, "2411")).toBe(1);
  });
});
