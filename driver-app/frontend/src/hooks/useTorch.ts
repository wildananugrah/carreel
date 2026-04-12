import { useCallback, useEffect, useState } from "react";

/**
 * Controls the device torch (flashlight) for a given MediaStream.
 *
 * Browser support:
 * - Works: Chrome/Edge/Samsung Internet on Android
 * - Does NOT work: Safari / any browser on iOS (Apple doesn't expose torch in WebKit)
 * - When unsupported, `available` stays false and the UI should hide the toggle button.
 *
 * Usage:
 *   const { available, enabled, toggle } = useTorch(streamRef.current);
 */
export function useTorch(stream: MediaStream | null) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // Probe the video track for torch capability whenever the stream changes.
  useEffect(() => {
    setEnabled(false);
    if (!stream) {
      setAvailable(false);
      return;
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      setAvailable(false);
      return;
    }

    // getCapabilities() returns an object that may include `torch: true` on supported devices.
    // The `torch` property is non-standard and not in the default TS types, so we cast.
    const capabilities = (
      track.getCapabilities as (() => MediaTrackCapabilities & { torch?: boolean }) | undefined
    )?.call(track);

    setAvailable(capabilities?.torch === true);
  }, [stream]);

  const toggle = useCallback(async () => {
    if (!stream || !available) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const next = !enabled;
    try {
      // `torch` is a non-standard constraint; cast to bypass TS.
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setEnabled(next);
    } catch {
      // Device rejected the constraint — keep state as-is.
    }
  }, [stream, available, enabled]);

  return { available, enabled, toggle };
}
