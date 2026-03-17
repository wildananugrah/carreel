import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] pb-20">
      <Outlet />
      <BottomNav />
    </div>
  );
}
