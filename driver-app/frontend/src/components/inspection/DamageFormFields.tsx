import { useMemo, useState } from "react";
import type { DamageMarker, DamageSeverity } from "../../lib/damage-api";
import { DAMAGE_LOCATIONS, SEVERITY_LABELS, SEVERITY_VALUES } from "../../lib/damage-locations";

export interface DamageFormValue {
  severity: DamageSeverity;
  location: string | null;
  description: string;
}

interface Props {
  initial: DamageFormValue;
  onChange: (next: DamageFormValue) => void;
  /** When true, all three fields render as required-looking (asterisk
   * marker). Used in AddDamageFlow where description is mandatory; the
   * EditDamageModal also passes true since editing always touches at
   * least one field. */
  required?: boolean;
}

/** Severity pills + searchable location dropdown + description textarea.
 * Used by both EditDamageModal and AddDamageFlow so the form layout is
 * identical between edit and add. */
export function DamageFormFields({ initial, onChange, required = true }: Props) {
  const [severity, setSeverity] = useState<DamageSeverity>(initial.severity);
  const [location, setLocation] = useState<string | null>(initial.location);
  const [description, setDescription] = useState(initial.description);
  const [locationQuery, setLocationQuery] = useState(initial.location ?? "");
  const [locationOpen, setLocationOpen] = useState(false);

  const filteredLocations = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    if (!q) return DAMAGE_LOCATIONS;
    return DAMAGE_LOCATIONS.filter((l) => l.toLowerCase().includes(q));
  }, [locationQuery]);

  const emit = (
    next: Partial<DamageFormValue> & {
      severity?: DamageSeverity;
      location?: string | null;
      description?: string;
    },
  ) =>
    onChange({
      severity: next.severity ?? severity,
      location: next.location !== undefined ? next.location : location,
      description: next.description ?? description,
    });

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="damage-severity"
          className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2"
        >
          Tingkat{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <div id="damage-severity" className="grid grid-cols-3 gap-2">
          {SEVERITY_VALUES.map((s) => {
            const active = severity === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSeverity(s);
                  emit({ severity: s });
                }}
                className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
                  active
                    ? "bg-yellow-400 text-black"
                    : "bg-[#1a1a1a] text-neutral-400 border border-[#2a2a2a]"
                }`}
              >
                {SEVERITY_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <label
          htmlFor="damage-location"
          className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2"
        >
          Lokasi{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <input
          id="damage-location"
          type="text"
          value={locationQuery}
          onChange={(e) => {
            setLocationQuery(e.target.value);
            setLocationOpen(true);
            // Clear committed location when user types a partial; commits
            // again only on selection from the dropdown.
            setLocation(null);
            emit({ location: null });
          }}
          onFocus={() => setLocationOpen(true)}
          onBlur={() => {
            // Delay close so onClick on a dropdown item registers first.
            setTimeout(() => setLocationOpen(false), 150);
          }}
          placeholder="Cari lokasi (mis. bumper, pintu, fender)…"
          className="w-full bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f]"
        />
        {locationOpen && filteredLocations.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#171717] shadow-lg">
            {filteredLocations.map((l) => (
              <button
                key={l}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setLocation(l);
                  setLocationQuery(l);
                  setLocationOpen(false);
                  emit({ location: l });
                }}
                className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-[#222222]"
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {locationOpen && filteredLocations.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#2a2a2a] bg-[#171717] px-3 py-2 text-sm text-neutral-500">
            Tidak ada lokasi yang cocok
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="damage-description"
          className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2"
        >
          Deskripsi{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <textarea
          id="damage-description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            emit({ description: e.target.value });
          }}
          placeholder="Jelaskan kerusakan yang terlihat..."
          rows={4}
          className="w-full bg-[#171717] text-white border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f] resize-none"
        />
      </div>
    </div>
  );
}

export function damageMarkerToFormValue(d: DamageMarker): DamageFormValue {
  return {
    severity: d.severity,
    location: d.location,
    description: d.description,
  };
}
