import { useEffect, useRef, useState } from "react";

interface DashboardSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function DashboardSearchBar({ value, onChange }: DashboardSearchBarProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    <div className="flex items-center gap-2.5 bg-[#161616] border border-[#252525] rounded-xl px-3.5 py-2.5">
      <span className="text-sm shrink-0">{"🔍"}</span>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder="Cari plat, tipe, driver..."
        className="flex-1 bg-transparent text-[13px] text-white placeholder-[#444] outline-none border-none"
      />
    </div>
  );
}
