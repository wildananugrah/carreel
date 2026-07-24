import { useState } from "react";

interface Props {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  /** "light" for images shown on a white/light card (e.g. the signature). Defaults to the app's dark theme. */
  theme?: "dark" | "light";
}

/**
 * Drop-in <img> replacement for network-loaded media (/api/media/.../url).
 * Fills its parent (every call site already wraps it in a fixed-size box,
 * e.g. aspect-video) with a shimmer skeleton until the image loads, then
 * fades it in. Falls back to a broken-image icon on error instead of
 * shimmering forever against a 404.
 */
export function MediaImage({ src, alt, className = "", onClick, theme = "dark" }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const skeletonBg = theme === "light" ? "bg-neutral-200" : "bg-[#1a1a1a]";
  const sweepGradient =
    theme === "light"
      ? "bg-gradient-to-r from-transparent via-white/80 to-transparent"
      : "bg-gradient-to-r from-transparent via-[#333]/60 to-transparent";
  const errorFg = theme === "light" ? "text-neutral-400" : "text-neutral-600";

  return (
    <div className="relative w-full h-full overflow-hidden">
      {!loaded && !errored && (
        <div className={`absolute inset-0 ${skeletonBg} overflow-hidden`}>
          <div
            className={`media-shimmer-sweep absolute inset-0 -translate-x-full ${sweepGradient}`}
          />
        </div>
      )}
      {errored ? (
        <div
          className={`absolute inset-0 flex items-center justify-center ${skeletonBg} ${errorFg}`}
        >
          <svg
            aria-hidden="true"
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: onClick is optional, caller-supplied (click-to-enlarge)
        <img
          src={src}
          alt={alt}
          className={`${className} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          onClick={onClick}
        />
      )}
    </div>
  );
}
