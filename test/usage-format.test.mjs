import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampUsedPercent,
  displayedPercentage,
  formatResetDuration,
} from "../web/src/lib/usage-format.ts";

describe("formatResetDuration", () => {
  it("floors durations to whole units and reports now for nonpositive values", () => {
    assert.equal(formatResetDuration(0), "now");
    assert.equal(formatResetDuration(-5), "now");
    assert.equal(formatResetDuration(47 * 60_000), "47m");
    assert.equal(formatResetDuration((3 * 60 + 54) * 60_000), "3h 54m");
    assert.equal(formatResetDuration(5 * 60 * 60_000), "5h");
    assert.equal(formatResetDuration((6 * 24 + 7) * 60 * 60_000), "6d 7h");
    assert.equal(formatResetDuration(2 * 24 * 60 * 60_000), "2d");
  });
});

describe("clampUsedPercent", () => {
  it("rounds and clamps to 0..100, with 0 for non-finite input", () => {
    assert.equal(clampUsedPercent(20.5), 21);
    assert.equal(clampUsedPercent(-4), 0);
    assert.equal(clampUsedPercent(140), 100);
    assert.equal(clampUsedPercent(Number.NaN), 0);
  });
});

describe("displayedPercentage", () => {
  it("shows used or remaining, rounding used before complementing", () => {
    assert.equal(displayedPercentage(20.5, "used"), 21);
    assert.equal(displayedPercentage(20.5, "remaining"), 79);
    assert.equal(displayedPercentage(Number.NaN, "remaining"), 0);
  });
});
