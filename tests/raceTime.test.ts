import { describe, expect, it } from "vitest";
import { RACE_UTC_OFFSET, toRaceLocalInput, withRaceZone } from "@/lib/raceTime";

describe("race-local datetime controls", () => {
  it("renders an instant in the race's own wall clock, not the machine's", () => {
    expect(toRaceLocalInput("2027-08-16T23:00:00Z")).toBe("2027-08-17T06:00");
    expect(toRaceLocalInput("2027-08-16T23:00:23Z", { seconds: true })).toBe("2027-08-17T06:00:23");
  });

  it("keeps the seconds a chip time depends on", () => {
    // A finisher's splits must total the elapsed time to within a second, so a minute-only
    // round trip would silently reject an otherwise valid save.
    const start = "2027-08-17T06:00:00+07:00";
    const finish = "2027-08-17T06:25:23+07:00";
    expect(withRaceZone(toRaceLocalInput(start, { seconds: true }))).toBe(start);
    expect(withRaceZone(toRaceLocalInput(finish, { seconds: true }))).toBe(finish);
  });

  it("has nothing to show for a missing or unparseable instant", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      expect(toRaceLocalInput(value)).toBe("");
    }
  });

  it("completes a minute-precision control and attaches the race offset", () => {
    expect(withRaceZone("2027-08-17T06:00")).toBe(`2027-08-17T06:00:00${RACE_UTC_OFFSET}`);
    expect(withRaceZone("2027-08-17T06:00:23")).toBe(`2027-08-17T06:00:23${RACE_UTC_OFFSET}`);
  });

  it("normalizes whatever shape the control reports back", () => {
    // A browser rewrites the value it was given: whole minutes lose their seconds, and some
    // engines add a fractional part. Chip timing is whole seconds, so both land on one form.
    expect(withRaceZone("2027-08-17T06:25:23.000")).toBe(`2027-08-17T06:25:23${RACE_UTC_OFFSET}`);
    expect(withRaceZone("2027-08-17T06:25:23.5")).toBe(`2027-08-17T06:25:23${RACE_UTC_OFFSET}`);
  });

  it("hands anything unrecognisable to the server untouched", () => {
    for (const value of ["2027-08-17", "06:25", "nonsense"]) {
      expect(withRaceZone(value)).toBe(value);
    }
  });

  it("passes an unfilled field through so the server rejects it with its own message", () => {
    expect(withRaceZone("")).toBe("");
    expect(withRaceZone(null)).toBeNull();
  });
});
