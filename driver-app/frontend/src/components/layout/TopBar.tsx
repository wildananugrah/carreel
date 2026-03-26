import { useNavigate } from "react-router-dom";

interface TopBarProps {
  title: string;
  subtitle?: string;
  subtitle2?: string;
  showBack?: boolean;
}

export function TopBar({ title, subtitle, subtitle2, showBack }: TopBarProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-[#171717] text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10 border-b border-[#2a2a2a]">
      {showBack && (
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-10 h-10 flex items-center justify-center -ml-2"
        >
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
        {subtitle2 && <p className="text-[10px] text-neutral-500">{subtitle2}</p>}
      </div>
    </div>
  );
}
