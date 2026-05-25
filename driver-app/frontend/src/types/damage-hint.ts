export interface DamageHint {
  timestampSeconds: number;
  bbox: [number, number, number, number]; // [x, y, w, h] as 0–1 fractions of frame
  damageClass: "dent" | "scratch";
  confidence: number;
}
