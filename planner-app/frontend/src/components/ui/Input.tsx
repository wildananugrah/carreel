import type { InputHTMLAttributes } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, className = "", ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-neutral-400 mb-1">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          "block w-full rounded-lg border px-3 py-2 text-sm bg-[#171717] text-white placeholder-neutral-500",
          "focus:outline-none focus:ring-2 focus:ring-offset-0",
          "transition-colors duration-150",
          "disabled:bg-[#0f0f0f] disabled:text-neutral-600",
          error
            ? "border-red-500 focus:ring-red-500 focus:border-red-500"
            : "border-[#2a2a2a] focus:ring-yellow-400 focus:border-yellow-400",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
