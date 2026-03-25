import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User } from "../lib/types";

export function Profile() {
  const { user, logout, updateUser } = useAuth();

  // Profile editing state
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const joinDate = user
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  function handleEditCancel() {
    setFullName(user?.fullName ?? "");
    setEditing(false);
    setProfileError("");
    setProfileSuccess("");
  }

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = fullName.trim();
    if (!trimmed) {
      setProfileError("Nama tidak boleh kosong");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    setProfileSuccess("");

    try {
      const updated = await api.patch<User>("/api/auth/profile", { fullName: trimmed });
      updateUser(updated);
      setEditing(false);
      setProfileSuccess("Profil berhasil diperbarui");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Gagal memperbarui profil");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Semua field harus diisi");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password baru minimal 6 karakter");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Konfirmasi password tidak cocok");
      return;
    }

    setPasswordSaving(true);
    setPasswordError("");
    setPasswordSuccess("");

    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password berhasil diubah");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Gagal mengubah password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-white mb-6">Profile</h1>

      {/* Profile Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#2a2a2a] flex items-center justify-center">
              <span className="text-neutral-300 font-bold text-xl">
                {user?.fullName?.charAt(0).toUpperCase() ?? "?"}
              </span>
            </div>
            <div>
              {editing ? (
                <form onSubmit={handleProfileSave} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f] placeholder-neutral-500"
                    placeholder="Nama lengkap"
                  />
                  <Button type="submit" size="sm" loading={profileSaving}>
                    Simpan
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handleEditCancel}>
                    Batal
                  </Button>
                </form>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-white">{user?.fullName}</h2>
                  <p className="text-sm text-neutral-500">{user?.email}</p>
                </>
              )}
            </div>
          </div>
          {!editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(true);
                setProfileSuccess("");
              }}
            >
              Edit
            </Button>
          )}
        </div>

        {profileError && <p className="text-sm text-red-400 mb-3">{profileError}</p>}
        {profileSuccess && <p className="text-sm text-emerald-400 mb-3">{profileSuccess}</p>}

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

      {/* Change Password Card */}
      <Card className="p-6 mt-4">
        <h3 className="text-base font-semibold text-white mb-4">Ubah Password</h3>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div>
            <label htmlFor="currentPassword" className="block text-sm text-neutral-500 mb-1">
              Password Saat Ini
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f] placeholder-neutral-500"
              placeholder="Masukkan password saat ini"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm text-neutral-500 mb-1">
              Password Baru
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f] placeholder-neutral-500"
              placeholder="Masukkan password baru (min. 6 karakter)"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm text-neutral-500 mb-1">
              Konfirmasi Password Baru
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f] placeholder-neutral-500"
              placeholder="Ulangi password baru"
            />
          </div>

          {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
          {passwordSuccess && <p className="text-sm text-emerald-400">{passwordSuccess}</p>}

          <Button type="submit" loading={passwordSaving}>
            Ubah Password
          </Button>
        </form>
      </Card>

      <div className="mt-6">
        <Button variant="danger" onClick={logout}>
          Log Out
        </Button>
      </div>
    </div>
  );
}
