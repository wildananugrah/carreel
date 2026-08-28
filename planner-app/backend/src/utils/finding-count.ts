/**
 * Finding counts for the PIC dashboard vehicle card.
 *
 * The card's badge counts FINDINGS (rows in `damage_markers`), not rows in
 * `alerts`. An alert is emitted at most once per step per category — a step
 * with four damages produces one `NEW_DAMAGE_DETECTED` row — so alert rows
 * never were a damage count. Alerts also include operational events
 * (LOW_FUEL, KM_ANOMALY, AI_FAILURE, SCREEN_RECAPTURE, VEHICLE_MISMATCH)
 * that are not findings at all, and they decay as planners mark them read.
 *
 * Splitting the tally by source is what makes the pair arithmetic correct;
 * see `countCardFindings`.
 */
export interface MarkerTally {
  /** AI-detected markers flagged as new on this inspection. */
  aiNew: number;
  /**
   * AI-detected markers re-recording damage an earlier trip already reported
   * (`isNewDamage = false`). On a post-trip these are the pre-trip's damages
   * seen again, which is why they must not be added twice.
   */
  aiCarriedOver: number;
  /**
   * Markers a driver added by hand (`source = DRIVER_ADDED`), regardless of
   * their `isNewDamage` flag. `POST /api/inspections/:id/damages` derives
   * that flag from the request body and defaults it to false, so it cannot be
   * used to decide whether a hand-added marker is a duplicate.
   */
  driverAdded: number;
}

export function emptyTally(): MarkerTally {
  return { aiNew: 0, aiCarriedOver: 0, driverAdded: 0 };
}

function total(t: MarkerTally): number {
  return t.aiNew + t.aiCarriedOver + t.driverAdded;
}

/**
 * How many distinct findings one vehicle card represents.
 *
 * A card is a pre-trip plus its linked post-trip. The post-trip's AI pass
 * re-records the damage the pre-trip already found, marking it
 * `isNewDamage = false`, so summing every marker across the pair would count
 * the same scratch twice. The pre-trip is the first record of those damages,
 * so it contributes all of its markers and the post-trip contributes only
 * what the pre-trip could not have reported:
 *
 *   - `aiNew`      — damage that genuinely appeared during the trip
 *   - `driverAdded` — a human observation, never an AI re-detection, so it is
 *                     never deduped even when its `isNewDamage` flag is false
 *
 * A standalone post-trip has no pre-trip to have reported anything, so all of
 * its markers count.
 */
export function countCardFindings(
  pre: MarkerTally | null,
  post: MarkerTally | null,
): number {
  if (!pre) return post ? total(post) : 0;
  return total(pre) + (post ? post.aiNew + post.driverAdded : 0);
}
