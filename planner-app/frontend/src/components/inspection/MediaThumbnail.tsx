import { useState } from "react";
import type { MediaFile } from "../../lib/types";

interface MediaThumbnailProps {
  file: MediaFile;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MediaThumbnail({ file }: MediaThumbnailProps) {
  const [showMeta, setShowMeta] = useState(false);

  return (
    <div className="relative group">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={() => setShowMeta(!showMeta)}
        className="block focus:outline-none focus:ring-2 focus:ring-yellow-400 rounded"
      >
        {file.mimeType.startsWith("image/") ? (
          <img
            src={`/api/media/${file.id}/url`}
            alt={file.fileName}
            className="w-20 h-20 object-cover rounded"
            loading="lazy"
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: User-uploaded video, captions unavailable
          <video
            src={`/api/media/${file.id}/stream`}
            className="w-20 h-20 object-cover rounded"
            preload="metadata"
          />
        )}
      </button>

      {/* Metadata tooltip */}
      {showMeta && (
        <div className="absolute bottom-full left-0 mb-1 bg-gray-900 text-white text-xs rounded px-2 py-1.5 whitespace-nowrap z-10 shadow-lg">
          <p>{formatDate(file.capturedAt)}</p>
          {file.latitude != null && (
            <p className="text-gray-300">
              GPS: {file.latitude.toFixed(4)}, {file.longitude?.toFixed(4)}
            </p>
          )}
          <p className="text-gray-300">{file.mediaType}</p>
        </div>
      )}
    </div>
  );
}
