import { useEffect, useState } from "react";
import { api } from "../../lib/api";
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
  const [url, setUrl] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    api
      .get<{ url: string }>(`/api/upload/presigned/${file.minioKey}?bucket=${file.minioBucket}`)
      .then((res) => setUrl(res.url))
      .catch(() => {});
  }, [file.minioKey, file.minioBucket]);

  if (!url) {
    return <div className="w-20 h-20 bg-gray-100 rounded animate-pulse" />;
  }

  return (
    <div className="relative group">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={() => setShowMeta(!showMeta)}
        className="block focus:outline-none focus:ring-2 focus:ring-gray-900 rounded"
      >
        {file.mimeType.startsWith("image/") ? (
          <img
            src={url}
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
