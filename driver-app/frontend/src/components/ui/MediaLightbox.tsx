import { useEffect, useRef } from "react";

interface MediaLightboxProps {
  src: string;
  type: "image" | "video";
  alt?: string;
  startTime?: number;
  onClose: () => void;
}

export function MediaLightbox({ src, type, alt, startTime, onClose }: MediaLightboxProps) {
  const scrollY = useRef(0);

  const videoRef = useRef<HTMLVideoElement>(null);

  const handleLoadedMetadata = () => {
    if (startTime != null && videoRef.current) {
      videoRef.current.currentTime = startTime;
      videoRef.current.pause();
    }
  };

  useEffect(() => {
    scrollY.current = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY.current}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY.current);
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled via useEffect
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      role="dialog"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors z-10"
        aria-label="Close"
      >
        <svg
          aria-hidden="true"
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {type === "image" ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only prevents event propagation
        <img
          src={src}
          alt={alt ?? ""}
          className="max-h-[90vh] max-w-[95vw] object-contain"
          onClick={(e) => e.stopPropagation()}
          decoding="async"
        />
      ) : (
        <video
          ref={videoRef}
          src={src}
          className="max-h-[90vh] max-w-[95vw]"
          controls
          autoPlay={startTime == null}
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onClick={(e) => e.stopPropagation()}
        >
          <track kind="captions" />
        </video>
      )}
    </div>
  );
}
