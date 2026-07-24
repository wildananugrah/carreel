export type PhotoTab = "wajib" | "tambahan";

interface Props {
  tab: PhotoTab;
  onTabChange: (tab: PhotoTab) => void;
  doneCount: number;
  totalCount: number;
}

export function PhotoTabSwitcher({ tab, onTabChange, doneCount, totalCount }: Props) {
  return (
    <div className="flex gap-2 mb-3 p-1 bg-[#141414] rounded-xl border border-[#2a2a2a]">
      <button
        type="button"
        onClick={() => onTabChange("wajib")}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
          tab === "wajib"
            ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/40"
            : "text-neutral-400 border border-transparent"
        }`}
      >
        Foto Body Wajib
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/40">
          {doneCount}/{totalCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onTabChange("tambahan")}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
          tab === "tambahan"
            ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/40"
            : "text-neutral-400 border border-transparent"
        }`}
      >
        Foto Tambahan
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#2a2a2a] text-neutral-300">
          Opsional
        </span>
      </button>
    </div>
  );
}
