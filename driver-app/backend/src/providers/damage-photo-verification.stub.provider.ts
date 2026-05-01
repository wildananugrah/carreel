import type {
  DamagePhotoVerificationInput,
  DamagePhotoVerificationOutcome,
  IDamagePhotoVerificationProvider,
} from "../interfaces/providers/damage-photo-verification.provider.interface";

/**
 * Stub provider — always returns PASSED. Used in dev/test environments
 * where AI is disabled, and as a placeholder until Phase 3 lands the
 * Gemini-backed implementation.
 */
export class DamagePhotoVerificationStubProvider
  implements IDamagePhotoVerificationProvider
{
  async verify(
    _input: DamagePhotoVerificationInput,
  ): Promise<DamagePhotoVerificationOutcome> {
    return { status: "PASSED", reason: null };
  }
}
