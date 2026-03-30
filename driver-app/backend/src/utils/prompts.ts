import type { StepType } from "../generated/prisma";

export interface DamageResult {
  damageType: string;
  location?: string;
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
  trim: string | null;
  bodyType: string | null;
  color: string | null;
  vin: string | null;
  confidence: number;
  screenRecaptureDetected: boolean;
  damages: DamageResult[];
}

export interface SpeedometerResult {
  odometerKm: number | null;
  fuelLevelPct: number | null;
  warningLights: string[];
  vehicleOn: boolean;
  dashboardMatch: boolean;
  vehicleMismatchDetected: boolean;
  brandMatchDetected?: boolean;
  modelMatchDetected?: boolean;
  generationMatchDetected?: boolean;
  trimMatchDetected?: boolean;
  confidence: number;
  screenRecaptureDetected: boolean;
}

export interface BodyInspectionResult {
  overallCondition: "GOOD" | "FAIR" | "POOR";
  confidence: number;
  screenRecaptureDetected: boolean;
  damages: DamageResult[];
}

/** Vehicle context passed to prompt builders when unit data is available */
export interface VehicleContext {
  make?: string | null;
  model?: string | null;
  color?: string | null;
  licensePlate?: string | null;
}

// ========================
// SCREEN-CAPTURE DETECTION (image vs video variants)
// ========================

const SCREEN_CAPTURE_IMAGE = `
[SCREEN-CAPTURE DETECTION PROTOCOL — PHOTO ONLY]

If the image may have come from a display, treat it as recapture.

TASK:
Detect whether the input image is a photograph of a screen/display (monitor, phone, tablet, TV, dashboard LCD, or any other digital display).

SCOPE:
This protocol applies ONLY to a single still image.
Do NOT use video-specific cues such as motion, parallax, flicker over time, or temporal refresh behavior.

HARD RULE:
If there is any reasonable indication that the image was photographed from a display, set screenRecaptureDetected = true.

PREVENTIVE POLICY:
False negatives are worse than false positives.
When in doubt, classify as true.

PRIMARY DISPLAY INDICATORS:
1. Rectangular screen boundary, bezel, frame, or black border.
2. UI-like content such as menus, icons, buttons, status bars, app layouts, overlays, text blocks, or interface elements.
3. Content appears unnaturally flat, as if everything is on one plane.
4. Reflection, glare, hotspot, or brightness falloff consistent with photographing a display.
5. Visible pixel structure, subpixel grid, aliasing, or moiré on the content area.
6. Uniform sharpness across the entire framed content, with no natural depth separation.
7. Perspective and geometry consistent with a camera capturing a screen surface rather than a real physical scene.
8. Signs that the image inside the frame is itself a digital render, screenshot, or screen photo.

SECONDARY CHECK:
Even if no obvious artifacts are visible, still classify as true if the scene strongly resembles a photographed display.

DASHBOARD TYPE EXCEPTION:
- Type A (Analog Dashboards): Expect physical needles and printed numbers. If there is a small digital LCD screen for the Odometer, moiré patterns/pixels are ONLY permitted strictly inside that small LCD box.
- Type B (Digital/EV Dashboards): Moiré patterns and pixel grids are expected, but must be strictly confined INSIDE the boundary of the main digital screen and must never bleed onto the outer physical bezels.

DO NOT REQUIRE any of these to flag as recapture:
- Moiré
- Flicker
- Motion
- Parallax
- Scan lines
- Temporal artifacts
`;

const SCREEN_CAPTURE_VIDEO = `
[SCREEN-CAPTURE DETECTION PROTOCOL — VIDEO]

If the video may have been recorded from a display, treat it as recapture.

TASK:
Detect whether the input video is a recording of a screen/display (monitor, phone, tablet, TV, or any other digital display).

HARD RULE:
If there is any reasonable indication that the video was recorded from a display, set screenRecaptureDetected = true.

PREVENTIVE POLICY:
False negatives are worse than false positives.
When in doubt, classify as true.

PRIMARY DISPLAY INDICATORS (any single one is sufficient):
1. Rectangular screen boundary, bezel, frame, or black border.
2. UI-like content such as menus, icons, buttons, status bars, app layouts, overlays, text blocks, or interface elements.
3. Content appears unnaturally flat, as if everything is on one plane.
4. Reflection, glare, hotspot, or brightness falloff consistent with recording a display.
5. Visible pixel structure, subpixel grid, aliasing, or moiré on the content area.
6. Uniform sharpness across the entire framed content, with no natural depth separation.
7. Perspective and geometry consistent with a camera capturing a screen surface rather than a real physical scene.
8. Signs that the content inside the frame is itself a digital render, screenshot, or pre-recorded video.

VIDEO-SPECIFIC INDICATORS (additional signals):
9. Flat-plane movement: The entire scene moves as one rigid block during camera motion, with no parallax between foreground and background.
10. Refresh flicker: Scrolling horizontal/vertical bands or pulsing brightness caused by shutter/refresh mismatch.
11. No focal depth shift: Everything stays in the same focus plane during camera movement (real 3D scenes show focus change).

SECONDARY CHECK:
Even if no obvious artifacts are visible, still classify as true if the scene strongly resembles a recorded display.

DO NOT REQUIRE any of these to flag as recapture:
- Moiré
- Flicker
- Scan lines
- These are bonus signals, not requirements.
`;

// ========================
// VEHICLE IDENTITY MATCHING
// ========================

function buildVehicleIdentityPrompt(vehicle: VehicleContext): string {
  const brand = vehicle.make ?? "";
  const model = vehicle.model ?? "";

  if (!brand && !model) return "";

  const expectedLabel = [
    brand,
    model,
    vehicle.color ? `(${vehicle.color})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
[STRICT VEHICLE IDENTITY MATCHING PROTOCOL — 6-STEP VERIFICATION]
EXPECTED VEHICLE: ${expectedLabel}
EXPECTED BRAND: ${brand || "UNKNOWN"}
EXPECTED MODEL: ${model || "UNKNOWN"}

This is a critical anti-fraud check. The dashboard/speedometer in this photo MUST belong to the EXPECTED VEHICLE listed above. Any mismatch means a driver may be submitting a photo from a different vehicle.

STEP 1 — SOURCE VALIDATION
Before analyzing dashboard identity, verify this is a genuine original photograph:
- Check for screen bezels, pixel grids, moiré patterns, UI overlays
- Check for unnatural flatness or uniform focus plane
- Check for reflections/glare consistent with photographing a display
If the image appears to be a photo of a screen/display, set screenRecaptureDetected = true.

STEP 2 — BLIND DASHBOARD IDENTIFICATION (DO THIS FIRST — NO PEEKING)
WITHOUT referencing the expected vehicle data above, analyze:
- Gauge cluster layout (analog dials vs. digital screen)
- Illumination color palette
- Font style and typography of numbers/text
- Needle/indicator design
- Digital display UI/UX patterns
- Brand logos, emblems, or text visible on dash
- EV-specific elements (battery indicator, power gauge, regen display)

From these visual cues alone, determine:
→ What brand made this dashboard?
→ What model family does it belong to?
→ What generation/year range?

STEP 3 — BRAND CROSS-CHECK
Compare identified brand vs. expected brand "${brand || "UNKNOWN"}":
- Each manufacturer has distinctive design DNA
- Toyota ≠ Honda ≠ Wuling ≠ Hyundai ≠ Suzuki ≠ Daihatsu ≠ Mitsubishi etc.
- Look for manufacturer-specific signatures:
  * Logo presence (steering wheel center, dash surface, digital display branding)
  * Brand-specific color schemes (e.g., Wuling's teal/cyan EV theme)
  * Proprietary UI elements (e.g., Toyota's multi-info display style)
Set brandMatchDetected = true only if brands match.

STEP 4 — MODEL CROSS-CHECK
Compare identified model vs. expected model "${model || "UNKNOWN"}":
- Within the same brand, models have distinct dashboards
- SUV ≠ Sedan ≠ MPV ≠ City Car ≠ Truck within the same brand
- Examples: Wuling Air EV ≠ Wuling Almaz; Toyota Avanza ≠ Toyota Fortuner
- Check: gauge count, display size, layout proportions, unique model features
Set modelMatchDetected = true only if models match.

STEP 5 — GENERATION & TRIM CHECK
- Same model but different generations often have completely redesigned dashboards
- Compare: digital vs analog transition, screen size evolution, design era
- Minor trim-level differences within the same model AND generation are acceptable
Set generationMatchDetected = true if generation appears consistent.
Set trimMatchDetected = true (acceptable if same model/generation with trim variation).

STEP 6 — FINAL VERDICT
Apply these rules strictly:
- If brandMatchDetected = false → vehicleMismatchDetected = true (REJECT)
- If modelMatchDetected = false → vehicleMismatchDetected = true (REJECT)
- If generationMatchDetected = false → vehicleMismatchDetected = true (REJECT)
- ONLY if all three match → vehicleMismatchDetected = false (PASS)

HARD RULE: When uncertain about ANY match, default to mismatch (vehicleMismatchDetected = true).
DO NOT give the benefit of the doubt.
`;
}

// ========================
// PROMPT BUILDERS (dynamic, vehicle-aware)
// ========================

export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
): string {
  switch (stepType) {
    case "UNIT_IDENTIFICATION":
      return buildUnitIdentificationPrompt();
    case "SPEEDOMETER":
      return buildSpeedometerPrompt(vehicle);
    case "BODY_INSPECTION":
      return buildBodyInspectionPrompt(vehicle);
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}

function buildUnitIdentificationPrompt(): string {
  return `You are a strict Vehicle Identification AI for a fleet management anti-fraud system.

Your task is to extract vehicle identification details that are directly visible in the image.
If there are multiple vehicles in the image, strictly focus ONLY on the primary, largest, or most centered vehicle.

Do NOT guess, infer, assume, estimate, or complete missing text or numbers.
If a detail is not fully and clearly visible, output null for that field.

${SCREEN_CAPTURE_IMAGE}

## TASKS

### 1. Vehicle Identification

Rules:
- Use only what can be directly seen in the image. Never hallucinate missing details.
- For License Plates:
  - Transcribe ONLY the main alphanumeric registration number that is clearly readable.
  - Ignore smaller regional text, jurisdiction names, or expiry dates.
  - If a character is uncertain, replace only that character with "?"
  - If the plate is not visible at all, set to null.
  - Do not add spaces, letters, or numbers that are not visible.
- For VIN:
  - Output the VIN only if it is fully visible and readable.
  - If any part is unclear, cropped, blurred, or obstructed, set to null.
- For Make, Model, Body Type, and Trim:
  - State Make, Model, and Trim ONLY if there is clear visual evidence (e.g., badges, grille text).
  - You may use visual recognition to identify Make, Model, and Body Type based on distinct physical design cues, but do NOT guess missing text.
  - If not certain, set to null.
- For Color:
  - Use the dominant visible exterior color only.
  - If the color is mixed, choose the main body color.
  - If the vehicle is too obscured to determine color, set to null.

### 2. Damage Assessment
Identify any visible damage on the vehicle exterior.
All damage "description" values MUST be written in Bahasa Indonesia.

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "licensePlate": "string or null",
  "make": "string or null",
  "model": "string or null",
  "trim": "string or null",
  "bodyType": "SUV|Sedan|Hatchback|Pickup|MPV|Van|Truck|Coupe|Convertible|Wagon|other or null",
  "color": "string or null",
  "vin": "string or null",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "scratch|dent|crack|rust|missing_part|broken_light|other",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "deskripsi singkat dalam Bahasa Indonesia",
      "isNewDamage": true,
      "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ]
}

Be strict - this is an anti-fraud verification measure.`;
}

function buildSpeedometerPrompt(vehicle?: VehicleContext | null): string {
  const hasVehicle = vehicle?.make || vehicle?.model;
  const vehicleIdentitySection = hasVehicle
    ? buildVehicleIdentityPrompt(vehicle)
    : "";
  const vehicleMatchFields = hasVehicle
    ? `  "vehicleMismatchDetected": true/false,
  "brandMatchDetected": true/false,
  "modelMatchDetected": true/false,
  "generationMatchDetected": true/false,
  "trimMatchDetected": true/false,`
    : `  "vehicleMismatchDetected": false,`;

  return `Act as a highly conservative vehicle dashboard OCR and indicator detection AI for a fleet management anti-fraud system.

Your only job is to extract information that is directly and clearly visible in the dashboard image.
Do not guess. Do not infer. Do not estimate from memory. Do not complete missing digits.
If any value is not fully legible, output null for that field.

${vehicleIdentitySection}
${SCREEN_CAPTURE_IMAGE}

## TASKS

Read the image step-by-step using these rules:

### 1. Vehicle ON Check
Determine if the vehicle's ignition is ON:
- Dashboard must be illuminated/lit up
- Digital displays should be active (showing numbers, icons)
- Indicator lights or gauges should be in their "ON" state
- A completely dark/off dashboard means the vehicle is NOT on

### 2. Odometer
- Locate the TOTAL mileage display only.
- Accept only the main odometer, usually labeled "ODO" or shown as the largest mileage number.
- Ignore TRIP A, TRIP B, average fuel economy, outside temperature, clock, and any other secondary display.
- Do NOT confuse with "Range" (estimated distance), speed (km/h), or RPM.
- Read only digits that are fully visible and unambiguous.
- If the full odometer value cannot be read with certainty, set to null.
- Return the number exactly as displayed, with no rounding.

### 3. Fuel Level
- Locate the fuel gauge only.
- Use the gas pump icon, E/F markers, or the fuel bar/needle.
- Describe the needle/bar position only based on what is visibly shown.
- Do not infer from vehicle type or typical tank size.
- If the gauge is unclear, set to null.
- If readable, estimate the fuel percentage conservatively from the visual position.

### 4. Warning Lights
- Identify only warning lights that are clearly illuminated.
- Do not report icons that are off, reflected, or uncertain.
- If no warning lights are clearly on, return an empty array.
- Use standard names: "check engine", "battery", "oil pressure", "temperature", "ABS", "airbag", "tire pressure", "brake", "door ajar", etc.

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "odometerKm": 0,
  "fuelLevelPct": 0,
  "warningLights": [],
  "vehicleOn": true,
  "dashboardMatch": true,
${vehicleMatchFields}
  "confidence": 0.0,
  "screenRecaptureDetected": false
}

Be strict - this is an anti-fraud verification measure.`;
}

function buildBodyInspectionPrompt(vehicle?: VehicleContext | null): string {
  const vehicleContext =
    vehicle?.make || vehicle?.model
      ? `\nVEHICLE BEING INSPECTED: ${[vehicle.make, vehicle.model, vehicle.color ? `(${vehicle.color})` : ""].filter(Boolean).join(" ")}\n`
      : "";

  return `You are a highly conservative Automotive Exterior Damage Appraiser AI for a fleet management anti-fraud system.
Your job is to inspect the vehicle's exterior in the provided VIDEO and report ONLY physical damage that is directly, clearly, and unambiguously visible.

You must prioritize accuracy over completeness. However, do not aggressively dismiss high-contrast marks (e.g., black scuffs on light paint) as dirt if they appear on typical impact zones like bumper corners.
${vehicleContext}
${SCREEN_CAPTURE_VIDEO}

## ABSOLUTE RULES FOR VIDEO PROCESSING

- DEDUPLICATION: You are analyzing a multi-frame video of a single vehicle. Track damage across frames. Do NOT report the same damage multiple times. Compile all findings into one deduplicated list.
- MOTION vs DAMAGE: Use the movement across video frames to confirm damage. Moving reflections, glare, or shifting shadows as the camera pans are NOT damage. Real physical damage (dents/scratches) will remain fixed on the vehicle's surface regardless of camera angle.
- VIDEO ARTIFACTS: Do not confuse motion blur, lens flares, or video compression artifacts with physical scuffs, bent panels, or paint transfer.
- Do not guess or infer hidden damage.
- Do not assume damage from shadows, reflections, glare, or perspective.
- Do not "complete" partially visible damage.
- Do not use vehicle type, brand, or common accident patterns to predict damage.
- Do not report normal design lines, panel gaps, trims, reflections, or lighting changes as damage.
- Distinguish between loose dirt/splatters and physical scuffs. Directional, high-contrast marks (like paint transfer or deep scratches) on corners or edges MUST be evaluated as damage, not dirt.
- Assess ONLY the primary subject vehicle in the foreground. Strictly ignore any vehicles, parts, or reflections in the background.
- If the overall video quality is too low, consistently blurry, or too dark to make an absolute assessment across frames, set overallCondition to null, confidence to 0, and return an empty damages array.

## STRICT DAMAGE TYPE DICTIONARY

You MUST use ONLY the following damageType values. Do NOT use any other words, synonyms, or variations:
- goresan (scratches — includes deep and light scratches)
- transfer_cat (paint transfer / scuff marks)
- penyok (dent or ding)
- kaca_retak (cracked or shattered glass)
- bagian_pecah (broken light, broken mirror, or other broken component)
- panel_bengkok (bent panel or deformation)
- bagian_hilang (missing part)

## STRICT LOCATION DICTIONARY

You MUST use ONLY the following location values for the "location" field. Do NOT use free-form text or any other values:
- Bumper Depan Kiri
- Bumper Depan Tengah
- Bumper Depan Kanan
- Bumper Belakang Kiri
- Bumper Belakang Tengah
- Bumper Belakang Kanan
- Pintu Depan Kiri
- Pintu Belakang Kiri
- Pintu Depan Kanan
- Pintu Belakang Kanan
- Fender Depan Kiri
- Panel Bodi Belakang Kiri
- Fender Depan Kanan
- Panel Bodi Belakang Kanan
- Atap
- Kap Mesin
- Bagasi
- Spion Kiri
- Spion Kanan
- Kaca Depan
- Kaca Belakang
- Roda / Ban
- Eksterior Tidak Jelas

## MANDATORY VISUAL SCAN ORDER

Observe the vehicle as it is presented in the video sequence, but ensure the final deduplicated report accounts for:
1. Front exterior
2. Rear exterior (Pay close attention to lower corners)
3. Left side
4. Right side
5. Roof
6. Glass and mirrors
7. Wheels and tires

## SEVERITY GUIDELINES

- MINOR: Small cosmetic issue (paint transfer, light scratch, ding) with no obvious structural impact
- MODERATE: Clearly visible damage affecting appearance or function, but not severe destruction
- MAJOR: Major deformation, broken components, shattered glass, missing major parts, or obvious structural-level damage

## IMPORTANT FINAL CHECK

Before finalizing:
- Remove anything that is uncertain
- Remove anything that could be a reflection or shadow
- Remove any damage that is not unmistakably visible
- Keep only confirmed exterior damage
- Determine if each confirmed damage appears to be new (fresh, sharp edges, recent paint disruption) or pre-existing (weathered, oxidized, old)
- Note the video timestamp (in seconds) where each damage is most clearly visible

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "overallCondition": "GOOD|FAIR|POOR",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "goresan|transfer_cat|penyok|kaca_retak|bagian_pecah|panel_bengkok|bagian_hilang",
      "location": "EXACT string from STRICT LOCATION DICTIONARY above",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "deskripsi singkat kerusakan dalam Bahasa Indonesia",
      "isNewDamage": true,
      "videoTimestamp": 0
    }
  ]
}

Be strict - this is an anti-fraud verification measure.`;
}

/**
 * @deprecated Use buildStepPrompt() instead. Kept for backward compatibility.
 */
export const STEP_PROMPTS: Record<StepType, string> = {
  UNIT_IDENTIFICATION: buildUnitIdentificationPrompt(),
  SPEEDOMETER: buildSpeedometerPrompt(),
  BODY_INSPECTION: buildBodyInspectionPrompt(),
};
