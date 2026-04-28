interface MediaPreviewProps {
  file: File;
}

export function MediaPreview({ file }: MediaPreviewProps) {
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");

  return (
    <div className="rounded-lg overflow-hidden bg-[#171717]">
      {isVideo ? (
        // biome-ignore lint/a11y/useMediaCaption: User-uploaded video preview, captions not available
        <video
          src={url}
          controls
          className="w-full max-h-64 object-contain"
          onLoad={() => URL.revokeObjectURL(url)}
        />
      ) : (
        <img
          src={url}
          alt="Preview"
          className="w-full max-h-64 object-contain"
          onLoad={() => URL.revokeObjectURL(url)}
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="px-3 py-2 text-xs text-neutral-500 truncate">
        {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
      </div>
    </div>
  );
}
