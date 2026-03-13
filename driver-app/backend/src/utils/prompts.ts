import type { StepType } from "../generated/prisma";

export interface DamageResult {
  damageType: string;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  description: string;
  isNewDamage: boolean;
  videoTimestamp?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface UnitIdentificationResult {
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  vin: string | null;
  confidence: number;
  damages: DamageResult[];
}

export interface SpeedometerResult {
  odometerKm: number | null;
  fuelLevelPct: number | null;
  dashboardMatch: boolean;
  confidence: number;
}

export interface BodyInspectionResult {
  overallCondition: "GOOD" | "FAIR" | "POOR";
  confidence: number;
  damages: DamageResult[];
}

export const STEP_PROMPTS: Record<StepType, string> = {
  UNIT_IDENTIFICATION: `You are a vehicle inspection AI. Analyze this image of a vehicle.
Identify the license plate number, make, model, color, and VIN if visible.
Also identify any visible damage on the vehicle exterior.

Respond ONLY with valid JSON in this exact format:
{
  "licensePlate": "string or null",
  "make": "string or null",
  "model": "string or null",
  "color": "string or null",
  "vin": "string or null",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "scratch|dent|crack|rust|missing_part|broken_light|other",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "brief description",
      "isNewDamage": true,
      "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ]
}`,

  SPEEDOMETER: `You are a vehicle inspection AI. Analyze this image of a vehicle dashboard/speedometer.
Read the odometer value in kilometers, fuel level as a percentage, and verify the dashboard is functioning.

Respond ONLY with valid JSON in this exact format:
{
  "odometerKm": 0,
  "fuelLevelPct": 0,
  "dashboardMatch": true,
  "confidence": 0.0
}`,

  BODY_INSPECTION: `You are a vehicle inspection AI. Analyze this video of a vehicle walk-around body inspection.
Assess the overall condition and identify all visible damages with their timestamps in the video.

Respond ONLY with valid JSON in this exact format:
{
  "overallCondition": "GOOD|FAIR|POOR",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "scratch|dent|crack|rust|missing_part|broken_light|tire_damage|other",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "brief description",
      "isNewDamage": true,
      "videoTimestamp": 0
    }
  ]
}`,
};
