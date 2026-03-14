interface FilterChipsProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T;
  onChange: (value: T) => void;
}

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
}: FilterChipsProps<T>) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selected === option.value
              ? "bg-teal-600 text-white"
              : "bg-white text-gray-600 border border-gray-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
