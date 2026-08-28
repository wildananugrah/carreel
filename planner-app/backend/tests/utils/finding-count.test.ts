import { describe, expect, test } from "bun:test";
import {
  countCardFindings,
  emptyTally,
  type MarkerTally,
} from "../../src/utils/finding-count";

function tally(over: Partial<MarkerTally> = {}): MarkerTally {
  return { ...emptyTally(), ...over };
}

describe("countCardFindings", () => {
  test("counts every marker on a pre-trip-only card", () => {
    const pre = tally({ aiNew: 2, aiCarriedOver: 1, driverAdded: 1 });
    expect(countCardFindings(pre, null)).toBe(4);
  });

  test("counts every marker on a standalone post-trip card", () => {
    // No pre-trip exists to have already reported the carried-over damage,
    // so nothing is deduped.
    const post = tally({ aiNew: 1, aiCarriedOver: 2, driverAdded: 1 });
    expect(countCardFindings(null, post)).toBe(4);
  });

  test("does not double-count damage the post-trip re-detected", () => {
    // Pre-trip finds 2 scratches. The post-trip records those same 2 with
    // isNewDamage=false, plus 1 genuinely new dent. The vehicle has 3.
    const pre = tally({ aiNew: 2 });
    const post = tally({ aiNew: 1, aiCarriedOver: 2 });
    expect(countCardFindings(pre, post)).toBe(3);
  });

  test("counts a driver-added post-trip finding even when not flagged new", () => {
    // POST /damages defaults isNewDamage to false unless the client sends
    // true. A hand-added marker is a human observation, never an AI
    // re-detection, so it must never be deduped away.
    const pre = tally({ aiNew: 1 });
    const post = tally({ driverAdded: 1 });
    expect(countCardFindings(pre, post)).toBe(2);
  });

  test("counts driver-added and new AI findings on the same post-trip", () => {
    const pre = tally({ aiNew: 2 });
    const post = tally({ aiNew: 1, aiCarriedOver: 2, driverAdded: 3 });
    expect(countCardFindings(pre, post)).toBe(6);
  });

  test("returns 0 when the card has no findings at all", () => {
    expect(countCardFindings(tally(), tally())).toBe(0);
    expect(countCardFindings(null, null)).toBe(0);
  });

  test("counts findings that carry no isNewDamage flag on the pre-trip", () => {
    // Pre-trip carry-overs still count: whatever the flag says, the pre-trip
    // is the first record of that damage on this card.
    const pre = tally({ aiCarriedOver: 3 });
    expect(countCardFindings(pre, null)).toBe(3);
  });
});
