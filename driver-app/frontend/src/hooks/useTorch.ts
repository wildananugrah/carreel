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
type TrackCapabilitiesWithTorch = MediaTrackCapabilities & { torch?: boolean };

function probeTorch(track: MediaStreamTrack): boolean {
  const getCaps = track.getCapabilities as (() => TrackCapabilitiesWithTorch) | undefined;
  if (!getCaps) return false;
  try {
    const caps = getCaps.call(track);
    return caps?.torch === true;
  } catch {
    return false;
  }
}

export function useTorch(stream: MediaStream | null) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // Probe the video track for torch capability whenever the stream changes.
  // On Android Chrome/Samsung Internet, getCapabilities() may return incomplete
  // data immediately after the stream starts — the torch capability appears
  // only after the track becomes "live" and produces frames. We retry a few
  // times with a short delay to handle this timing quirk.
  useEffect(() => {
    setEnabled(false);
    setAvailable(false);

    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const tryProbe = () => {
      if (cancelled) return;
      attempts += 1;

      const hasTorch = probeTorch(track);
      // eslint-disable-next-line no-console
      console.log(`[useTorch] probe attempt ${attempts}/${maxAttempts}`, {
        readyState: track.readyState,
        hasTorch,
        capabilities: (
          track.getCapabilities as (() => TrackCapabilitiesWithTorch) | undefined
        )?.call(track),
      });

      if (hasTorch) {
        setAvailable(true);
        return;
      }
      if (attempts < maxAttempts && track.readyState === "live") {
        setTimeout(tryProbe, 200);
      }
    };

    // First probe: immediately
    tryProbe();

    return () => {
      cancelled = true;
    };
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[useTorch] applyConstraints failed", err);
    }
  }, [stream, available, enabled]);

  return { available, enabled, toggle };
}
