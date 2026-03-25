import { useEffect, useRef, useState } from "react";

interface DashboardSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function DashboardSearchBar({ value, onChange }: DashboardSearchBarProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), 300);
  }

  return (
    <div className="relative">
      <svg
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder="Cari plat, tipe, driver..."
        className="w-64 pl-9 pr-3 py-2 text-sm rounded-lg bg-[#171717] text-white placeholder-neutral-500 border border-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 transition-colors"
      />
    </div>
  );
}
