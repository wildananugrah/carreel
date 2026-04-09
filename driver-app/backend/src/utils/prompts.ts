import type { StepType } from "../generated/prisma";

export interface DamageResult {
  damageType: string;
  location?: string;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  description: string;
  orientationReason?: string;
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
  cameraPath: string;
  visualAnalysis: string;
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

If the image may have come from a display or screenshot, treat it as recapture.

TASK:
Detect whether the input image is:
A) A photograph of a screen/display (monitor, phone, tablet, TV), OR
B) A screenshot or saved image being re-submitted instead of a live camera capture.

SCOPE:
This protocol applies ONLY to a single still image.
Do NOT use video-specific cues such as motion, parallax, flicker over time, or temporal refresh behavior.

HARD RULE:
If there is any reasonable indication that the image was photographed from a display OR is a screenshot, set screenRecaptureDetected = true.

PREVENTIVE POLICY:
False negatives are worse than false positives.
When in doubt, classify as true.

CRITICAL SCREENSHOT INDICATORS (any single one = TRUE):
1. ROUNDED CORNERS on black/dark borders — phone screenshots always have rounded corners. Real camera photos NEVER have rounded corners on the image boundary.
2. Uniform black/dark padding or letterboxing on any side of the image — this means the photo was displayed on a screen with aspect ratio mismatch and then re-captured or screenshotted.
3. The main content is visibly CONTAINED within a smaller rectangle inside the image — the photo-within-a-photo pattern.
4. Perfect geometric alignment of borders — real photos of dashboards have irregular edges where the dashboard meets the car interior. If borders are perfectly straight and uniform, it is a screen.

DISPLAY CAPTURE INDICATORS (any single one = TRUE):
5. Physical device bezel, frame, or monitor edge visible.
6. UI-like content such as menus, icons, buttons, status bars, app layouts, overlays, or navigation elements from a phone/computer interface.
7. Reflection, glare, hotspot, or brightness falloff consistent with photographing a display surface.
8. Visible pixel structure, subpixel grid, or moiré OUTSIDE the dashboard screen area (on bezels, steering wheel, car interior).
9. Content appears unnaturally flat — everything is on one focal plane with no depth separation between foreground (steering wheel) and background (dashboard).
10. Perspective distortion consistent with photographing a flat screen at an angle.

COMPARISON TEST — REAL vs SCREEN:
A REAL dashboard photo will show:
- Natural depth: steering wheel is closer/blurrier than dashboard
- Irregular edges where dashboard meets car interior
- Natural lighting variation across 3D surfaces
- No black borders or padding around the image

A SCREEN CAPTURE will show:
- Flat focal plane: everything equally sharp
- Clean, uniform borders (especially rounded corners)
- The dashboard image is "contained" within a visible rectangle
- Aspect ratio padding (black bars)

DASHBOARD TYPE EXCEPTION (applies ONLY to the dashboard screen itself):
- Type A (Analog Dashboards): Expect physical needles and printed numbers. If there is a small digital LCD for the Odometer, moiré/pixels are ONLY permitted inside that small LCD box.
- Type B (Digital/EV Dashboards): Moiré patterns and pixel grids are expected on the dashboard's own digital display surface. BUT: check for the screenshot/screen-capture indicators above AROUND the dashboard. If the dashboard photo itself is inside a frame with rounded corners or uniform padding, it is a screen capture regardless of what the dashboard looks like.

IMPORTANT: The Dashboard Type Exception does NOT override the screenshot indicators. A real photo of a digital dashboard will NOT have rounded corners, uniform black padding, or the photo-within-a-photo pattern.

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
  const licensePlate = vehicle.licensePlate ?? "";

  if (!brand && !model) return "";

  return `
FOCUS STEP — STRICT VEHICLE IDENTITY MATCHING (PHOTO ONLY, FAIL-CLOSED)

TASK:
You will receive a single still photo of a vehicle dashboard / speedometer / instrument cluster.
Your job is to verify whether the visible dashboard matches the EXPECTED VEHICLE identity.

CONTEXT:
The expected vehicle data below was extracted by AI from a separate Unit Identification photo (exterior photo showing the vehicle's brand badge, license plate, body shape, etc.) taken earlier in the same inspection session.
Your job is to cross-verify: does the dashboard in THIS photo belong to the same vehicle identified in that Unit Identification step?

EXPECTED VEHICLE (from Unit Identification AI result):
- Brand: ${brand || "UNKNOWN"}
- Model: ${model || "UNKNOWN"}${licensePlate ? `\n- License Plate: ${licensePlate}` : ""}
- Generation: UNKNOWN
- Trim/Variant: NOT PROVIDED
- Year: NOT PROVIDED

SCOPE:
- PHOTO ONLY.
- Do NOT use video-specific cues.
- Do NOT rely on motion, parallax over time, flicker over time, refresh behavior, or temporal changes.
- Evaluate only the visible still image.

STEP 1 — SOURCE VALIDATION
First determine whether the image appears to be:
A) a real photographed vehicle dashboard, or
B) a photo of a screen/display showing a dashboard.

If the image appears to be a photo of a screen/display, immediately set:
vehicleMismatchDetected = true

STEP 2 — VISUAL FINGERPRINT EXTRACTION
Extract the visible dashboard fingerprint from the photo:
- Cluster shape and screen geometry
- Layout position and architecture
- Font style and typography
- Odometer placement
- Speedometer style
- Warning icon style
- UI density and complexity
- Color scheme
- Presence/absence of analog needles, LCD sections, or full digital panels
- Dashboard bezel and surrounding physical design
- Any brand/model-specific signature elements

Ignore aftermarket accessories, phone holders, added decorations, custom head units, stickers, or non-OEM objects.
Focus strictly on the OEM instrument cluster and its immediate surrounding architecture.

STEP 3 — STRICT CROSSCHECK AGAINST EXPECTED VEHICLE
Compare the extracted fingerprint against the EXPECTED VEHICLE.

Use strict identity matching, not broad similarity matching.
Do NOT accept:
- "looks close"
- "same category"
- "same class"
- "similar dashboard style"
- "might be another year but close enough"

STEP 4 — BRAND / MODEL / GENERATION / TRIM / YEAR CHECK

1. BRAND MATCH
Does the dashboard architecture match the expected brand family?

2. MODEL MATCH
Does the cluster layout and UI design match the expected model family?

3. GENERATION MATCH
Does the dashboard design belong to the expected generation or official design family?

4. TRIM / VARIANT MATCH
If Trim is not provided, accept only OEM dashboard variants officially available for the same brand, model, market, and generation.
A valid analog or digital cluster is acceptable only if it is an official OEM variant for that exact vehicle family.

STEP 5 — HARD REJECTION RULES
Immediately set vehicleMismatchDetected = true if ANY of the following are visible:
- The dashboard clearly belongs to a different manufacturer
- The layout clearly belongs to a different model family
- The cluster architecture is inconsistent with the expected generation
- The UI style is from a different design family or clearly different generation
- The dashboard appears too modern, too old, too wide, too minimal, or structurally different from the expected vehicle
- The image is likely a photo of a screen/display rather than a real dashboard photo
- The dashboard is heavily modified in a way that obscures the OEM identity
- The match is uncertain, partial, or only visually similar

STEP 6 — FAIL-CLOSED POLICY
This is a strict identity verification task, not a similarity task.
If the dashboard is not a strong match to the expected brand/model/generation, reject it.
If brand and model match, but year is unknown because it cannot be verified from the photo alone, do not reject solely for that reason unless an exact year is explicitly required and the visible evidence contradicts it.
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

Allowed Body Types: SUV, Sedan, Hatchback, Pickup, MPV, Van, Truck, Coupe, Convertible, Wagon, other
Allowed Damage Types: scratch, dent, crack, rust, missing_part, broken_light, other
Allowed Severities: MINOR, MODERATE, MAJOR

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings. Use null (without quotes) for unknown string values:

{
  "licensePlate": null,
  "make": null,
  "model": null,
  "trim": null,
  "bodyType": null,
  "color": null,
  "vin": null,
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "scratch",
      "severity": "MINOR",
      "description": "Terdapat goresan pada panel kiri",
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
    ? `  "vehicleMismatchDetected": false,
  "brandMatchDetected": true,
  "modelMatchDetected": true,
  "generationMatchDetected": true,
  "trimMatchDetected": true,`
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
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

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

  return `You are an Expert Automotive Exterior Damage Appraiser AI for a fleet management anti-fraud system, optimized for HIGH RECALL.

Your primary failure mode to avoid is MISSING damage. Over-reporting a minor scratch is acceptable. Missing a real scratch is not.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report all physical damage that is visible across frames.

Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that it is not fixed to the surface.
${vehicleContext}
${SCREEN_CAPTURE_VIDEO}

ABSOLUTE RULES FOR VIDEO PROCESSING

- SPATIAL ORIENTATION (EXTERIOR ANCHOR RULES - CRITICAL):
  Do NOT rely on the screen's left/right edges, especially during close-ups. You MUST determine Left (Kiri) and Right (Kanan) from the CAR'S OWN PERSPECTIVE using center anchors.

  Left (Kiri) and Right (Kanan) are ALWAYS from the car's perspective — as if sitting in the driver's seat facing forward.
  - Kiri = PASSENGER side (in Indonesia, right-hand drive)
  - Kanan = DRIVER's side (in Indonesia, where the steering wheel is)

  1. THE CENTER ANCHORS: The Rear License Plate (Plat Nomor Belakang) and Front License Plate/Logo are the EXACT CENTER of the vehicle.

  2. TRACKING THE CAMERA PATH (Crucial):
     - Watch how the camera moves across the Center Anchors.
     - REAR BUMPER RULE: If the camera is on the Rear Bumper and moves ACROSS the Rear License Plate, it is crossing from one side to the other.
     - For example: If the camera films a corner, then moves to the Rear License Plate, then moves to another corner -> You MUST label one corner as KANAN and the other as KIRI. They cannot be the same side.

  3. DRIVER vs PASSENGER SIDE: Indonesia is Right-Hand Drive.
     - Assume standard anatomy: If you see the steering wheel outline or know the camera is on the driver's side, that entire side is RIGHT (Kanan).

  4. CLOSE-UP CORNER LOGIC (Jebakan Zoom-In):
     - If the camera zooms in on a corner and the License Plate is NOT visible, DO NOT guess based on the left/right of the screen. Look at the relationship between the Taillight/Headlight and the Side Body (doors/wheels).
     - REAR CORNER (Melihat Lampu Merah Belakang + Bodi Samping):
       * If the side body of the car is on the RIGHT side of the taillight in your screen -> It is the RIGHT side of the car (Bumper/Bodi Belakang Kanan).
       * If the side body of the car is on the LEFT side of the taillight in your screen -> It is the LEFT side of the car (Bumper/Bodi Belakang Kiri).
     - FRONT CORNER (Melihat Lampu Putih Depan + Bodi Samping):
       * If the side body of the car is on the RIGHT side of the headlight in your screen -> It is the LEFT side of the car (Bumper/Bodi Depan Kiri).
       * If the side body of the car is on the LEFT side of the headlight in your screen -> It is the RIGHT side of the car (Bumper/Bodi Depan Kanan).

  PER-DAMAGE VERIFICATION (MANDATORY):
  For EVERY damage you report, you MUST include an "orientationReason" field that explains:
  1. Which anchor (license plate, taillights, headlights) is visible or was recently crossed
  2. Which side of the center anchor the damage is on
  3. Conclusion: Kiri or Kanan from the car's perspective
  This prevents systematic L/R errors by forcing per-damage reasoning.

- EXHAUSTIVE SCANNING (PEMINDAIAN MENYELURUH):
  * You MUST analyze the entire video from start to finish (0:00 to end).
  * Do NOT reduce attention after finding the first damage instance.
  * The vehicle may have multiple damages on different sides. You are required to find and list ALL distinct damages that are physically fixed to the vehicle surface and visible in at least ONE frame with reasonable clarity. There is no minimum severity threshold — report all findings including Ringan.
  * Apply frame-by-frame attention to these HIGH-PRIORITY SCRATCH ZONES:
    - All 4 door panels (especially lower panels and edges near door handles)
    - Front left and right fenders
    - All bumper corners
    - Both side mirrors (housing and cap)
    - Lower body panels along the full length of the vehicle

- DEDUPLICATION & MULTIPLE DAMAGES:
  * Track damage across frames. Do NOT report the exact same physical damage multiple times from different angles.
  * If the same mark appears in multiple frames from different angles, count it as ONE damage item.
  * CRITICAL: If there are multiple DISTINCT and SEPARATE damages on the same panel (e.g., two different scratches on 'Bumper Depan Kiri'), you MUST report them as separate entries. Do NOT merge separate damages just because they share a location.

- MOTION vs DAMAGE:
  * Moving reflections, glare, or shifting shadows as the camera pans are NOT damage. Real physical damage (dents, scratches) will remain fixed on the vehicle's surface regardless of camera angle.
  * EXCEPTION FOR GORESAN (SCRATCHES): Scratches naturally change in visibility as the camera angle shifts due to light refraction on the paint surface. A linear mark that is clearly visible in one frame but fades in another AT THE SAME FIXED LOCATION is physical damage — NOT a moving reflection. Do NOT use changing visibility alone as grounds to dismiss a scratch.

- GORESAN (SCRATCH) DETECTION RULES:
  * A mark qualifies as Goresan if it is a LINEAR/CURVED mark, OR a BROAD SCUFF/ABRASION (patch of scratched surface), OR edge chipping.
  * It must be visible in at least 1 frame with reasonable clarity AND does not move or shift position between frames.
  * Scratches legitimately appear and disappear depending on light angle. This is expected. Do NOT dismiss a scratch solely because it is not visible in every frame.
  * EXCLUSION: Strictly ignore general microscopic swirl marks (spiderweb scratches) caused by routine car washing. Focus ONLY on distinct, incident-related damage.
  * Visual characteristics to look for:
    - Bright white or silver highlights on the surface (clear coat scratch)
    - Dark or matte lines against glossy paint (deep paint scratch)
    - Broad patches of scuffing/abrasion (lecet) often found on bumper corners
    - Paint chips or rough marks along the vertical edges of doors
    - Clusters of fine lines near door handle zones or lower body panels
    - Single long linear marks consistent with key scratches or parking contact
  * If you detect a mark that COULD be a Goresan but you are uncertain, you MUST still report it with severity "MINOR" and add "(low confidence)" to the description. It is better to over-report a minor scratch than to miss it entirely.

- VIDEO ARTIFACTS: Do not confuse motion blur, lens flares, or video compression artifacts with physical damage.
- Do not guess or infer hidden damage.
- Assess ONLY the primary subject vehicle. Strictly ignore any vehicles, objects, or reflections in the background.
- If the overall video quality is too low, consistently blurry, or too dark to make an accurate assessment, set overallCondition to "POOR", confidence to 0, and return an empty damages array.

STRICT DICTIONARY (ENUMS)
You MUST select damageType and location EXCLUSIVELY from the exact lists below. DO NOT use any other words, synonyms, English terms, or extra descriptions.

ALLOWED TYPES (damageType):
- goresan
- transfer_cat
- penyok
- kaca_retak
- bagian_pecah
- panel_bengkok
- bagian_hilang

ALLOWED LOCATIONS (location):
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

MANDATORY VISUAL SCAN ORDER
Analyze the video in sequence but ensure the final deduplicated report accounts for all zones:
1. Front exterior (bumper, hood, headlights surround, front fenders)
2. Rear exterior — pay close attention to lower bumper corners
3. Left side (all doors, fender, rear quarter panel, mirror)
4. Right side (all doors, fender, rear quarter panel, mirror)
5. Roof
6. Glass and mirrors
7. Wheels and tires

SEVERITY DEFINITIONS (apply per damage type):

Goresan:
- MINOR = Surface-level scratch, clear coat only, paint color intact
- MODERATE = Scratch reaches base paint layer, color disrupted or exposed
- MAJOR = Scratch reaches bare metal, OR length exceeds 15cm, OR cluster of multiple scratches in same zone

Penyok:
- MINOR = Minor depression, no paint damage, not visible from 1 meter
- MODERATE = Clearly visible depression with possible paint cracking
- MAJOR = Large or deep deformation, structural panel shape compromised

Transfer Cat:
- MINOR = Small paint transfer, surface only, under 5cm
- MODERATE = Visible transfer with underlying paint disruption
- MAJOR = Large transfer area or combined with underlying dent or scratch

All other types (Kaca Retak, Bagian Pecah, Panel Bengkok, Bagian Hilang):
- MINOR = Minor, localized, does not affect function
- MODERATE = Moderate, affects appearance significantly
- MAJOR = Severe, affects safety or structural integrity

REASONING BEFORE OUTPUT:
You MUST perform spatial and visual reasoning BEFORE listing damages:
1. "cameraPath": Trace the chronological camera movement using center anchors (license plate). Example: "Kamera mulai dari Bodi Samping Kanan, lalu menyorot Bumper Belakang Kanan, menyeberangi Plat Nomor Belakang di tengah, lalu berakhir di Bumper Belakang Kiri."
2. "visualAnalysis": Describe the marks found along that path and confirm whether each is real damage or reflection.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. All description fields MUST be in Bahasa Indonesia. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

{
  "cameraPath": "Jalur perekaman kamera secara kronologis menggunakan anchor",
  "visualAnalysis": "Analisis visual singkat: cacat yang ditemukan dan konfirmasi apakah kerusakan asli atau pantulan",
  "overallCondition": "GOOD",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "goresan",
      "location": "Bumper Belakang Kiri",
      "severity": "MINOR",
      "description": "Goresan putih linear pada panel bawah, sekitar 8cm",
      "orientationReason": "Kerusakan terletak di sisi kiri dari plat nomor belakang = Kiri kendaraan",
      "isNewDamage": true,
      "videoTimestamp": 0
    }
  ]
}

This is a high-recall anti-fraud verification system. When in doubt, report.`;
}

/**
 * @deprecated Use buildStepPrompt() instead. Kept for backward compatibility.
 */
export const STEP_PROMPTS: Record<StepType, string> = {
  UNIT_IDENTIFICATION: buildUnitIdentificationPrompt(),
  SPEEDOMETER: buildSpeedometerPrompt(),
  BODY_INSPECTION: buildBodyInspectionPrompt(),
};
