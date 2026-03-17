import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-neutral-400">
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full px-3 py-2.5 rounded-lg border text-base bg-[#171717] text-white placeholder-neutral-500 ${
          error ? "border-red-500 focus:ring-red-500" : "border-[#2a2a2a] focus:ring-yellow-400"
        } focus:outline-none focus:ring-2 focus:ring-offset-0`}
        {...props}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
