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
  screenRecaptureDetected: boolean;
  damages: DamageResult[];
}

export interface SpeedometerResult {
  odometerKm: number | null;
  fuelLevelPct: number | null;
  vehicleOn: boolean;
  dashboardMatch: boolean;
  vehicleMismatchDetected: boolean;
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
[SCREEN-CAPTURE DETECTION PROTOCOL: IMAGE FORENSICS]

STEP A — PIXEL & SENSOR INTERFERENCE (FAIL-FIRST):
Scan the image for electronic interference caused by interaction between the recording sensor and a display. If any are present, set screenRecaptureDetected to true immediately.
1. Moire Patterns: Look for shimmering, "rainbow" waves, or geometric patterns overlaying PHYSICAL objects. These occur when the camera's pixel grid overlaps with a display's pixel grid. Physical objects (steering wheel, plastic dashboard, gauge needles) DO NOT have pixels.
2. Scan Lines & Refresh Artifacts: Identify horizontal or vertical bands of light/darkness. This is a synchronization mismatch between the camera's shutter and the display's refresh rate.
3. RGB Sub-pixel Structure: In high-resolution or close-up shots, check for visible "mesh" or individual Red, Green, and Blue sub-pixel clusters. Physical dashboards do not have a mesh texture.

STEP B — REFLECTION & SURFACE BEHAVIOR:
1. Static "Screen-in-Screen" Reflections: Look for reflections of the room where the photo was taken (e.g., a ceiling fan, a window, or the person holding the phone) appearing inside the dashboard area.
2. Surface Matte vs. Glass Gloss: Digital monitors often have anti-glare coating or a perfectly flat glass surface. Real dashboards have depth behind the glass; if the light "hits" the image of the needle rather than the glass protecting it, it's a screen.
3. Bezel Continuity: Check the extreme edges of the frame. Is there a consistent black border (monitor/TV bezel), laptop keyboard, or device UI (phone notch, status bar) visible?
4. Micro-Texture Validation: Check for natural material micro-texture on surfaces such as dashboard plastic or leather grain. Real car interiors contain irregular textures, tiny dust particles, or wear patterns. If surfaces appear unnaturally smooth, perfectly uniform, or display-like -> REJECT.

DASHBOARD TYPE EXCEPTION:
- Type A (Analog Dashboards): Expect physical needles and printed numbers. If there is a small digital LCD screen for the Odometer, moire patterns/pixels are ONLY permitted strictly inside that small LCD box.
- Type B (Digital/EV Dashboards): Moire patterns and pixel grids are expected, but must be strictly confined INSIDE the boundary of the main digital screen and must never bleed onto the outer physical bezels.

CONCLUSION:
- PASS: Natural micro-textures, 3D structural depth, zero moire/flicker interference on physical surfaces -> set screenRecaptureDetected to false.
- REJECT: Sub-pixel grid visibility, screen reflections, bezel edges, or unnaturally smooth surfaces -> set screenRecaptureDetected to true.
`;

const SCREEN_CAPTURE_VIDEO = `
[SCREEN-CAPTURE DETECTION PROTOCOL: VIDEO FORENSICS]

STEP A — PIXEL & SENSOR INTERFERENCE (FAIL-FIRST):
Scan the video for electronic interference caused by the interaction between the recording sensor and a target display. If any are present, set screenRecaptureDetected to true immediately.
1. Dynamic Moire Patterns: Look for shimmering, "rainbow" waves, or geometric patterns that shift as the camera moves. These occur when the camera's pixel grid overlaps with a display's pixel grid.
2. Scan Lines & Refresh Flicker: Identify horizontal or vertical bands of light/darkness (scrolling bars) or a constant high-frequency pulse. This is a synchronization mismatch between the camera's shutter speed and the monitor's refresh rate.
3. RGB Sub-pixel Structure: In high-resolution or close-up shots, can you see the "mesh" or the individual Red, Green, and Blue sub-pixel clusters? Physical dashboards do not have a mesh texture.

STEP B — OPTICAL DEPTH & MOTION PARALLAX:
Analyze how the scene behaves during camera movement. A screen is a flat 2D plane; a car interior is a 3D space.
1. The Parallax Test (Crucial): If the camera moves even slightly, does the steering wheel shift its position relative to the dashboard behind it?
  - REAL: The foreground moves faster than the background (depth).
  - SCREEN: The entire image moves as one rigid, flat block.
2. Focal Plane Shift: Does the camera's focus change?
  - REAL: When the camera focuses on the dashboard grain, the background (seat/window) or foreground (steering wheel) should blur.
  - SCREEN: Everything on the "dashboard" stays in the same focus plane because it's all on one flat surface.

STEP C — REFLECTION & SURFACE BEHAVIOR:
1. Static "Screen-in-Screen" Reflections: Look for reflections of the room where the video is being recorded (e.g., a ceiling fan, a window, or the person holding the phone) appearing inside the dashboard.
2. Surface Matte vs. Glass Gloss: Digital monitors often have anti-glare coating or a perfectly flat glass surface. Real dashboards have depth behind the glass; if the light "hits" the image of the needle rather than the glass protecting it, it's a screen.
3. Bezel Continuity: Check the extreme edges of the frame. Is there a consistent black border (monitor bezel) that remains perfectly static while the "car interior" inside it moves?
4. Micro-Texture Validation: Check for natural material micro-texture on surfaces such as dashboard plastic or leather grain. Real car interiors contain irregular textures, tiny dust particles, or wear patterns. If surfaces appear unnaturally smooth, perfectly uniform, or display-like -> REJECT.

DASHBOARD TYPE EXCEPTION:
- Type A (Analog Dashboards): Expect physical needles and printed numbers. If there is a small digital LCD screen for the Odometer, moire patterns/pixels are ONLY permitted strictly inside that small LCD box.
- Type B (Digital/EV Dashboards): Moire patterns and pixel grids are expected, but must be strictly confined INSIDE the boundary of the main digital screen and must never bleed onto the outer physical bezels.

CONCLUSION:
- PASS: If the video shows multi-plane motion parallax, natural focal shifts, natural micro-textures, and zero moire/flicker interference on physical surfaces -> set screenRecaptureDetected to false.
- REJECT: If the scene exhibits flat-plane movement, refresh rate flickering, sub-pixel grid visibility, or unnaturally smooth surfaces -> set screenRecaptureDetected to true.
`;

// ========================
// VEHICLE IDENTITY MATCHING
// ========================

function buildVehicleIdentityPrompt(vehicle: VehicleContext): string {
  const parts: string[] = [];
  if (vehicle.make) parts.push(vehicle.make);
  if (vehicle.model) parts.push(vehicle.model);
  if (vehicle.color) parts.push(`(${vehicle.color})`);

  if (parts.length === 0) return "";

  const expectedVehicle = parts.join(" ");

  return `
[STRICT VEHICLE IDENTITY MATCHING PROTOCOL]
EXPECTED VEHICLE: ${expectedVehicle}

STEP 1 — FORCED VISUAL EXTRACTION (DO THIS FIRST):
Before looking at the EXPECTED VEHICLE, you MUST internally identify the defining characteristics of the uploaded dashboard:
- For Analog Dashboards: Analyze the gauge layout (number of dials), illumination color, font style, and the exact placement of the small digital Odometer screen.
- For Digital/EV Dashboards: Analyze the software UI/UX design. Look at the typography (font), the layout of the digital speed numbers, the design of the battery/power indicator, and the presence of any digital car avatar or 3D graphic on the screen.

STEP 2 — THE CROSS-EXAMINATION:
Compare the exact visual footprint extracted in Step 1 against the known factory design (both physical structure and software UI) of the EXPECTED VEHICLE.

STEP 3 — THE STRICT VERDICT:
- REJECT: If the dashboard design (whether physical dials or digital UI) clearly belongs to a completely different manufacturer, or a blatantly different generation/model than the EXPECTED VEHICLE, set vehicleMismatchDetected to true.
- DO NOT USE trim variations as an excuse to pass completely different dashboard or software architectures.
- PASS: ONLY if the visual layout perfectly aligns or is reasonably consistent with the EXPECTED VEHICLE, set vehicleMismatchDetected to false.
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
  return `You are a vehicle inspection AI for a fleet management anti-fraud system. Analyze this PHOTO of a vehicle.

## TASKS

### 1. Vehicle Identification
Identify the license plate number, make, model, color, and VIN if visible.

### 2. Damage Assessment
Identify any visible damage on the vehicle exterior.

${SCREEN_CAPTURE_IMAGE}

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "licensePlate": "string or null",
  "make": "string or null",
  "model": "string or null",
  "color": "string or null",
  "vin": "string or null",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "scratch|dent|crack|rust|missing_part|broken_light|other",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "brief description",
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
  const vehicleMismatchField = hasVehicle
    ? `  "vehicleMismatchDetected": true/false,`
    : `  "vehicleMismatchDetected": false,`;

  return `You are a vehicle inspection AI for a fleet management anti-fraud system. Analyze this PHOTO of a vehicle's speedometer/dashboard.

${vehicleIdentitySection}
${SCREEN_CAPTURE_IMAGE}

## TASKS

### 1. Vehicle ON Check
Determine if the vehicle's ignition is ON:
- Dashboard must be illuminated/lit up
- Digital displays should be active (showing numbers, icons)
- Indicator lights or gauges should be in their "ON" state
- A completely dark/off dashboard means the vehicle is NOT on

### 2. Speedometer/Odometer Extraction
- Locate the MAIN ODOMETER (total KM driven) reading
- CRITICAL: Look for "ODO" label or the main total mileage number
- Do NOT confuse with "Range" (estimated distance), "Trip A/B" (temporary), or speed (km/h)
- Extract the exact number in kilometers
- If partially visible but readable, still extract it
- If completely unreadable, set to null

### 3. Fuel Level
- Read the fuel gauge percentage if visible
- If not visible or unreadable, set to null

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "odometerKm": 0,
  "fuelLevelPct": 0,
  "vehicleOn": true,
  "dashboardMatch": true,
${vehicleMismatchField}
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

  return `You are a vehicle inspection AI for a fleet management anti-fraud system. Analyze this VIDEO of a vehicle walk-around body inspection.
${vehicleContext}
${SCREEN_CAPTURE_VIDEO}

## TASKS

### 1. Overall Condition Assessment
Assess the overall condition of the vehicle exterior: GOOD, FAIR, or POOR.

### 2. Damage Identification
Identify all visible damages with their timestamps in the video.
- Note the video timestamp (in seconds) where each damage is visible
- Classify damage type and severity
- Determine if each damage appears to be new (fresh, recent) or pre-existing (weathered, old)

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "overallCondition": "GOOD|FAIR|POOR",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "scratch|dent|crack|rust|missing_part|broken_light|tire_damage|other",
      "severity": "MINOR|MODERATE|MAJOR",
      "description": "brief description",
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
