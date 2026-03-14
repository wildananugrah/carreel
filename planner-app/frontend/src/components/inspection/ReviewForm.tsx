import { type FormEvent, useState } from "react";
import { api } from "../../lib/api";
import type { ReviewDecision } from "../../lib/types";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";

interface ReviewFormProps {
  inspectionId: string;
  onSubmitted: () => void;
}

const decisionOptions = [
  { value: "", label: "Select decision..." },
  { value: "APPROVED", label: "Approve" },
  { value: "REJECTED", label: "Reject" },
  { value: "NEEDS_MORE_INFO", label: "Needs More Info" },
];

export function ReviewForm({ inspectionId, onSubmitted }: ReviewFormProps) {
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setLoading(true);
    setError("");
    try {
      await api.post(`/api/inspections/${inspectionId}/reviews`, {
        decision: decision as ReviewDecision,
        notes: notes || undefined,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Submit Review</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>
        )}

        <Select
          label="Decision"
          options={decisionOptions}
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          required
        />

        <div>
          <label htmlFor="review-notes" className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            id="review-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
            placeholder="Add review notes..."
          />
        </div>

        <Button type="submit" disabled={!decision} loading={loading}>
          Submit Review
        </Button>
      </form>
    </div>
  );
}
