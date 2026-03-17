import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../lib/auth";

export function Profile() {
  const { user, logout } = useAuth();

  const joinDate = user
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Profile" />

      <div className="flex-1 px-4 pt-6">
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-yellow-400/20 flex items-center justify-center">
              <span className="text-yellow-400 font-bold text-xl">
                {user?.fullName?.charAt(0).toUpperCase() ?? "?"}
              </span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{user?.fullName}</h2>
              <p className="text-sm text-neutral-500">{user?.email}</p>
            </div>
          </div>

          <div className="space-y-3 border-t border-[#2a2a2a] pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Role</span>
              <span className="text-white font-medium capitalize">{user?.role?.toLowerCase()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Member since</span>
              <span className="text-white font-medium">{joinDate}</span>
            </div>
          </div>
        </Card>

        <div className="mt-6">
          <Button variant="danger" className="w-full" onClick={logout}>
            Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}
