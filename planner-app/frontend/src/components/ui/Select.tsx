import type { SelectHTMLAttributes } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

export function Select({ label, options, id, className = "", ...props }: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-neutral-400 mb-1">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={[
          "block w-full rounded-lg border border-[#2a2a2a]",
          "bg-[#171717] text-white text-sm px-3 py-2",
          "focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-0",
          "focus:border-yellow-400",
          "transition-colors duration-150",
          "disabled:bg-[#0f0f0f] disabled:text-neutral-600",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
