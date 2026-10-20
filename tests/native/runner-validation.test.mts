import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ainaInput, citraDnfInput, dewaDnsInput } from "../fixtures/runners.ts";
import { InvalidRunnerDataError, validateRunnerChipInput } from "../../lib/runnerValidation.ts";

describe("chip input boundary", () => {
  it("normalizes numeric strings without changing Aina's contract", () => {
    const input = ainaInput();
    assert.deepEqual(validateRunnerChipInput({ ...input, distance_km: "5", avg_pace_sec_km: "304.60", splits: input.splits.map(s => ({ ...s, split_seconds: String(s.split_seconds) })) }), input);
  });
  it("removes unexpected private fields", () => {
    const result = validateRunnerChipInput({ ...ainaInput(), email: "private@example.test", access_token: "secret" });
    assert.equal("email" in result, false);
    assert.equal("access_token" in result, false);
  });
  it("preserves DNF and DNS with null finish fields", () => {
    for (const input of [citraDnfInput(), dewaDnsInput()]) assert.deepEqual(validateRunnerChipInput(input), input);
  });
  it("rejects nonpositive, nonfinite and nonnumeric split durations", () => {
    for (const duration of [0, -1, Infinity, NaN, "NaN", "", " ", true, null]) {
      assert.throws(() => validateRunnerChipInput({ ...ainaInput(), splits: [{ km_marker: 1, split_seconds: duration }] }), InvalidRunnerDataError);
    }
  });
  it("rejects duplicate, out-of-range and fractional kilometer markers", () => {
    for (const splits of [
      [{ km_marker: 1, split_seconds: 300 }, { km_marker: 1, split_seconds: 301 }],
      [{ km_marker: 6, split_seconds: 300 }],
      [{ km_marker: 1.5, split_seconds: 300 }],
    ]) assert.throws(() => validateRunnerChipInput({ ...ainaInput(), splits }), InvalidRunnerDataError);
  });
  it("allows missing chip reads without inventing timing", () => {
    assert.deepEqual(validateRunnerChipInput({ ...ainaInput(), splits: [] }).splits, []);
    assert.equal(validateRunnerChipInput(citraDnfInput()).elapsed_seconds, null);
  });
  it("rejects any non-finisher finish statistic", () => {
    for (const field of ["elapsed_seconds", "avg_pace_sec_km", "category_rank", "overall_rank", "category_percentile"]) {
      assert.throws(() => validateRunnerChipInput({ ...citraDnfInput(), [field]: 1 }), InvalidRunnerDataError);
    }
  });
  it("rejects contradictory lifecycle, distance, pace and identity fields", () => {
    for (const fields of [
      { finisher: true, start_status: "dns" }, { distance_km: 10 },
      { avg_pace_sec_km: 400 }, { elapsed_seconds: null },
      { gender: "invalid" }, { category_percentile: 1.1 },
      { runner_id: "not-a-uuid" }, { category_rank: 1.5 },
    ]) assert.throws(() => validateRunnerChipInput({ ...ainaInput(), ...fields }), InvalidRunnerDataError);
  });
  it("checks optional raw timestamps and strips them from output", () => {
    const input = { ...ainaInput(), start_time: "2027-08-17T06:00:00Z", finish_time: "2027-08-17T06:25:23Z" };
    assert.deepEqual(validateRunnerChipInput(input), ainaInput());
    assert.throws(() => validateRunnerChipInput({ ...input, finish_time: "2027-08-17T06:25:24Z" }), InvalidRunnerDataError);
    assert.throws(() => validateRunnerChipInput({ ...input, start_time: "invalid" }), InvalidRunnerDataError);
  });
  it("does not classify a record with no observed start as DNF", () => {
    assert.throws(() => validateRunnerChipInput({ ...citraDnfInput(), start_time: null, finish_time: null }), InvalidRunnerDataError);
    assert.deepEqual(validateRunnerChipInput({ ...citraDnfInput(), start_time: "2027-08-17T06:00:00Z", finish_time: null }), citraDnfInput());
  });
});
