import { useState } from "react";
import { createPortal } from "react-dom";
import { type DamageMarker, damageApi } from "../../lib/damage-api";
import {
  DamageFormFields,
  type DamageFormValue,
  damageMarkerToFormValue,
} from "./DamageFormFields";

interface Props {
  inspectionId: string;
  damage: DamageMarker;
  onClose: () => void;
  onSaved: (updated: DamageMarker) => void;
}

/** Bottom-sheet modal for editing the severity / location / description
 * fields on a single damage. Photo cannot be edited here — only added.
 * Mounted via createPortal so the sheet sits above the wizard chrome. */
export function EditDamageModal({ inspectionId, damage, onClose, onSaved }: Props) {
  const [value, setValue] = useState<DamageFormValue>(damageMarkerToFormValue(damage));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    value.severity !== damage.severity ||
    value.location !== damage.location ||
    value.description !== damage.description;

  const handleSave = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (!value.description.trim()) {
      setError("Deskripsi wajib diisi");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await damageApi.edit(inspectionId, damage.id, {
        severity: value.severity,
        location: value.location,
        description: value.description.trim(),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan perubahan");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-md bg-[#0f0f0f] rounded-t-2xl border-t border-[#2a2a2a] p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-center mb-3">
          <span className="block w-10 h-1 rounded-full bg-[#2a2a2a]" />
        </div>
        <h2 className="text-lg font-bold text-white mb-4">Edit Kerusakan</h2>

        <DamageFormFields initial={value} onChange={setValue} />

        {error && (
          <p className="mt-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="py-3 rounded-lg text-sm font-bold bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !value.description.trim()}
            className="py-3 rounded-lg text-sm font-bold bg-yellow-400 text-black hover:bg-yellow-300 disabled:opacity-50"
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
