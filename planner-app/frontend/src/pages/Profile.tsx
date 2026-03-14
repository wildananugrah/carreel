import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../lib/auth";

export function Profile() {
  const { user, logout } = useAuth();

  const joinDate = user
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Profile</h1>

      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-gray-700 font-bold text-xl">
              {user?.fullName?.charAt(0).toUpperCase() ?? "?"}
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{user?.fullName}</h2>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-200 pt-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Role</span>
            <span className="text-gray-900 font-medium capitalize">
              {user?.role?.toLowerCase()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Member since</span>
            <span className="text-gray-900 font-medium">{joinDate}</span>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <Button variant="danger" onClick={logout}>
          Log Out
        </Button>
      </div>
    </div>
  );
}
