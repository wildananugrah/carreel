import { useState } from "react";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User } from "../lib/types";

export function Profile() {
  const { user, logout, refreshUser } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const joinDate = user
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";

  function startEditing() {
    setFullName(user?.fullName ?? "");
    setEmail(user?.email ?? "");
    setError("");
    setSuccess("");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setError("");
    setSuccess("");
  }

  async function handleSave() {
    if (!fullName.trim()) {
      setError("Name is required");
      return;
    }
    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await api.put<User>("/api/auth/me", {
        fullName: fullName.trim(),
        email: email.trim(),
      });
      await refreshUser();
      setEditing(false);
      setSuccess("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Profile" />

      <div className="flex-1 px-4 pt-6">
        <Card className="p-6">
          {/* Avatar + Info */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-yellow-400/20 flex items-center justify-center">
              <span className="text-yellow-400 font-bold text-xl">
                {user?.fullName?.charAt(0).toUpperCase() ?? "?"}
              </span>
            </div>
            {!editing && (
              <div>
                <h2 className="text-lg font-semibold text-white">{user?.fullName}</h2>
                <p className="text-sm text-neutral-500">{user?.email}</p>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <Input
                label="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
              />
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-2">
                <Button className="flex-1" loading={saving} onClick={handleSave}>
                  Save
                </Button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="flex-1 py-2.5 text-sm font-medium text-neutral-400 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg active:bg-[#222222] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 border-t border-[#2a2a2a] pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Role</span>
                  <span className="text-white font-medium capitalize">
                    {user?.role?.toLowerCase()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Member since</span>
                  <span className="text-white font-medium">{joinDate}</span>
                </div>
              </div>

              {success && (
                <p className="text-sm text-green-400 mt-3">{success}</p>
              )}

              <button
                type="button"
                onClick={startEditing}
                className="w-full mt-4 py-2.5 text-sm font-medium text-yellow-400 bg-yellow-400/10 rounded-lg active:bg-yellow-400/20 transition-colors"
              >
                Edit Profile
              </button>
            </>
          )}
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
