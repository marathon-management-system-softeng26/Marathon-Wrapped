import { describe, expect, it } from "vitest";
import {
  CONSENT_AGE,
  DEFAULT_MIN_AGE,
  ageOnRaceDay,
  describeAgeRule,
  describeEligibilityProblem,
  latestEligibleBirthDate,
  requiresParentalConsent,
} from "@/lib/eligibility";

const RACE = "2027-08-17";

describe("race-day age bounds", () => {
  it("derives the inclusive latest birth date for each category minimum", () => {
    expect(latestEligibleBirthDate(RACE, DEFAULT_MIN_AGE["5K"])).toBe("2014-08-17");
    expect(latestEligibleBirthDate(RACE, DEFAULT_MIN_AGE["10K"])).toBe("2010-08-17");
  });

  it("treats a runner born exactly on the bound as eligible, matching whole-year age()", () => {
    const bound = latestEligibleBirthDate(RACE, 13);
    expect(ageOnRaceDay(bound, RACE)).toBe(13);
    // Exactly at the 5K minimum, and still under the consent age, so consent carries the save.
    expect(describeEligibilityProblem(bound, RACE, "5K", 13, true)).toBe("");
  });

  it("clamps a leap-day race date to a date that exists in the target year", () => {
    expect(latestEligibleBirthDate("2028-02-29", 13)).toBe("2015-02-28");
    expect(ageOnRaceDay("2015-02-28", "2028-02-29")).toBe(13);
  });

  it("has no bound for an unusable event date or age", () => {
    expect(latestEligibleBirthDate("2027-02-31", 13)).toBe("");
    expect(latestEligibleBirthDate(null, 13)).toBe("");
    expect(latestEligibleBirthDate(RACE, -1)).toBe("");
  });
});

describe("age on race day", () => {
  it.each([
    ["1995-04-12", 32],
    ["2014-08-17", 13],
    ["2014-08-18", 12],
    ["2014-12-31", 12],
    ["2010-08-17", 17],
  ])("counts whole years completed by race day for %s", (dateOfBirth, expected) => {
    expect(ageOnRaceDay(dateOfBirth, RACE)).toBe(expected);
  });

  it("reports nothing rather than guessing for an incomplete date", () => {
    for (const value of [null, undefined, "", "2014", "2014-08"]) {
      expect(ageOnRaceDay(value, RACE)).toBeNull();
    }
  });
});

describe("what the organizer is told", () => {
  it("names the rule, the race day and the bound", () => {
    expect(describeAgeRule("10K", 17, RACE)).toBe(
      "A 10K runner must be 17 on race day (17 Aug 2027). Latest date of birth: 17 Aug 2010.",
    );
  });

  it("falls back to the rule alone when the event date is unknown", () => {
    expect(describeAgeRule("5K", 13, null)).toBe("A 5K runner must be 13 on race day.");
  });

  it("explains an under-minimum date of birth with the runner's actual race-day age", () => {
    const problem = describeEligibilityProblem("2014-08-18", RACE, "5K", 13, false);
    expect(problem).toContain("is 12 on race day");
    expect(problem).toContain("Latest date of birth: 17 Aug 2014.");
  });

  it("holds a 10K entry to its own higher minimum", () => {
    expect(describeEligibilityProblem("2014-08-17", RACE, "5K", 13, true)).toBe("");
    expect(describeEligibilityProblem("2014-08-17", RACE, "10K", 17, true)).toContain("is 13 on race day");
  });

  it("demands consent below the consent age and accepts it once recorded", () => {
    expect(requiresParentalConsent("2013-08-17", RACE)).toBe(true);
    expect(requiresParentalConsent("2010-08-17", RACE)).toBe(false);
    expect(describeEligibilityProblem("2013-08-17", RACE, "5K", 13, false)).toBe(
      `This runner is 14 on race day. Under ${CONSENT_AGE} needs recorded parental consent.`,
    );
    expect(describeEligibilityProblem("2013-08-17", RACE, "5K", 13, true)).toBe("");
  });

  it("stays quiet while the field is still empty", () => {
    expect(describeEligibilityProblem("", RACE, "5K", 13, false)).toBe("");
  });
});
