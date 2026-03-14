import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import type { TripType } from "../lib/types";

export function CreateInspection() {
  const navigate = useNavigate();
  const [tripType, setTripType] = useState<TripType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!tripType) return;
    setLoading(true);
    setError("");

    let latitude: number | undefined;
    let longitude: number | undefined;

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
        }),
      );
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // GPS is optional — continue without it
    }

    try {
      const inspection = await api.post<{ id: string }>("/api/inspections", {
        tripType,
        latitude,
        longitude,
      });
      navigate(`/inspections/${inspection.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setLoading(false);
    }
  }

  const options: { type: TripType; label: string; description: string }[] = [
    {
      type: "PRE_TRIP",
      label: "Pre-Trip",
      description: "Before starting your route",
    },
    {
      type: "POST_TRIP",
      label: "Post-Trip",
      description: "After completing your route",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <TopBar title="New Inspection" />

      <div className="flex-1 px-4 pt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Select Trip Type</h2>
        <p className="text-sm text-gray-500 mb-6">Choose when this inspection is taking place</p>

        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => setTripType(opt.type)}
              className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                tripType === opt.type ? "border-teal-600 bg-teal-50" : "border-gray-200 bg-white"
              }`}
            >
              <p className="font-medium text-gray-900">{opt.label}</p>
              <p className="text-sm text-gray-500 mt-0.5">{opt.description}</p>
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-4">{error}</div>
        )}

        <div className="mt-8">
          <Button className="w-full" disabled={!tripType} loading={loading} onClick={handleCreate}>
            Create Inspection
          </Button>
        </div>
      </div>
    </div>
  );
}
