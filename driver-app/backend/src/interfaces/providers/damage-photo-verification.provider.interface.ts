/**
 * Verifies a driver-captured damage evidence photo before the damage is
 * persisted to the inspection. Implemented in Phase 3 by a Gemini-backed
 * provider that reuses the screen-capture detection protocol and runs a
 * vehicle-identity check against the inspection's expected make/model.
 *
 * The driver-app waits inline (~5–15s) for this to resolve before the
 * `POST /damages` route returns.
 */
export interface DamagePhotoVerificationInput {
  /** Raw image bytes the driver just captured. */
  photo: Buffer;
  mimeType: string;
  /** Vehicle context from the inspection's linked unit. May be partial. */
  vehicle: {
    make?: string | null;
    model?: string | null;
    color?: string | null;
    licensePlate?: string | null;
  } | null;
}

export type DamagePhotoVerificationOutcome =
  | { status: "PASSED"; reason: null }
  | {
      status:
        | "FAILED_SCREEN_CAPTURE"
        | "FAILED_VEHICLE_MISMATCH"
        | "FAILED_OTHER";
      reason: string;
    };

export interface IDamagePhotoVerificationProvider {
  verify(
    input: DamagePhotoVerificationInput,
  ): Promise<DamagePhotoVerificationOutcome>;
}
