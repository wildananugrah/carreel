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

export interface VinNumberResult {
  vinExtraction: {
    imageLegibilityIsSufficient: boolean;
    rawDetectedText: string;
    sanitizedVin: string | null;
    characterCount: number;
  };
  decodedData: {
    make: string;
    model: string;
    manufacturingYear: string;
    countryOfOrigin: string;
  };
  validationResult: {
    status: "MATCH" | "MISMATCH" | "UNCERTAIN";
    reasoning: string;
  };
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

export interface BodyVerificationResult {
  analisisVerifikasi: string;
  statusVerifikasi: "Match" | "Mismatch" | "Uncertain";
  confidence: number;
}

/** Vehicle context passed to prompt builders when unit data is available */
export interface VehicleContext {
  make?: string | null;
  model?: string | null;
  color?: string | null;
  licensePlate?: string | null;
}

/** Pair of system instruction (static rules) and user prompt (dynamic per-request content) */
export interface PromptPair {
  systemInstruction: string;
  userPrompt: string;
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
// VEHICLE IDENTITY MATCHING (rules only, no values)
// ========================

const VEHICLE_IDENTITY_RULES = `
FOCUS STEP — STRICT VEHICLE IDENTITY MATCHING (PHOTO ONLY, FAIL-CLOSED)

TASK:
You will receive a single still photo of a vehicle dashboard / speedometer / instrument cluster.
Your job is to verify whether the visible dashboard matches the EXPECTED VEHICLE identity.

CONTEXT:
The expected vehicle data below was extracted by AI from a separate Unit Identification photo (exterior photo showing the vehicle's brand badge, license plate, body shape, etc.) taken earlier in the same inspection session.
Your job is to cross-verify: does the dashboard in THIS photo belong to the same vehicle identified in that Unit Identification step?

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

// ========================
// PROMPT BUILDERS (dynamic, vehicle-aware)
// ========================

export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
): PromptPair {
  switch (stepType) {
    case "UNIT_IDENTIFICATION":
      return buildUnitIdentificationPrompt();
    case "VIN_NUMBER":
      return buildVinNumberPrompt(vehicle);
    case "SPEEDOMETER":
      return buildSpeedometerPrompt(vehicle);
    case "BODY_INSPECTION":
      return buildBodyInspectionPrompt(vehicle);
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}

function buildUnitIdentificationPrompt(): PromptPair {
  const systemInstruction = `You are a strict Vehicle Identification AI for a fleet management anti-fraud system.

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

  const userPrompt =
    "Analyze this vehicle image. Extract identification details and assess any visible damage.";

  return { systemInstruction, userPrompt };
}

function buildSpeedometerPrompt(vehicle?: VehicleContext | null): PromptPair {
  const hasVehicle = vehicle?.make || vehicle?.model;
  const vehicleIdentityRulesSection = hasVehicle ? VEHICLE_IDENTITY_RULES : "";
  const vehicleMatchFields = hasVehicle
    ? `  "vehicleMismatchDetected": false,
  "brandMatchDetected": true,
  "modelMatchDetected": true,
  "generationMatchDetected": true,
  "trimMatchDetected": true,`
    : `  "vehicleMismatchDetected": false,`;

  const systemInstruction = `Act as a highly conservative vehicle dashboard OCR and indicator detection AI for a fleet management anti-fraud system.

Your only job is to extract information that is directly and clearly visible in the dashboard image.
Do not guess. Do not infer. Do not estimate from memory. Do not complete missing digits.
If any value is not fully legible, output null for that field.

${vehicleIdentityRulesSection}
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

  let userPrompt = "Analyze this dashboard image.";
  if (hasVehicle) {
    const brand = vehicle?.make ?? "UNKNOWN";
    const model = vehicle?.model ?? "UNKNOWN";
    const licensePlate = vehicle?.licensePlate ?? "";
    userPrompt += `\n\nEXPECTED VEHICLE (from Unit Identification AI result):
- Brand: ${brand}
- Model: ${model}${licensePlate ? `\n- License Plate: ${licensePlate}` : ""}
- Generation: UNKNOWN
- Trim/Variant: NOT PROVIDED
- Year: NOT PROVIDED`;
  }

  return { systemInstruction, userPrompt };
}

function buildVinNumberPrompt(vehicle?: VehicleContext | null): PromptPair {
  const systemMake = vehicle?.make ?? "";
  const systemModel = vehicle?.model ?? "";

  const systemInstruction = `ROLE:
You are an Elite Forensic Automotive Data Auditor specializing exclusively in ISO 3779 global Vehicle Identification Number (VIN) extraction, sanitization, and strict database matching. Your core function is to guarantee 100% accuracy in identifying new car units within a high-throughput logistics environment.

OBJECTIVE:
Analyze the provided image that focuses on the Vehicle Identification Number (VIN) plate or sticker. You must locate the VIN area, extract the string, validate its format (exactly 17 digits, correct characters), decode basic metadata, and rigorously verify it against provided system input. You operate on a "Fail-Closed" protocol: if there is any legibility doubt or format error, you MUST reject the match as UNCERTAIN.

SYSTEM INPUT DATA:
• [SYSTEM_MAKE] = ${systemMake || "(not available)"}
• [SYSTEM_MODEL] = ${systemModel || "(not available)"}

CRITICAL "DO NOT" CONSTRAINTS (MANDATORY):
• DO NOT use conversational language or output markdown syntax like \`\`\`json.
• DO NOT hallucinate or infer missing or obscured digits. If glare, dirt, or angle makes a character ambiguous, you MUST flag it as unreadable.
• DO apply screen recapture detection: if the image appears to be a photograph of a screen, monitor, printout, or digitally rendered text rather than a direct camera capture of a physical VIN plate, set screenRecaptureDetected to true.
• DO NOT force-match. A close match is NOT a MATCH. If the extracted data deviates from system input, it is a MISMATCH.
• DO NOT attempt to locate or read any other text in the image (like license plates, engine numbers, or service stickers) unless they are part of the VIN plate/sticker structure.

STEP-BY-STEP EXECUTION PROTOCOL:

STEP 1: CLARITY & LEGIBILITY ASSESSMENT
Focus purely on the VIN region. Evaluate if the character clarity, glare, and resolution are sufficient to confidently extract exactly 17 characters without ambiguity. If legibility is poor, skip to outputting status UNCERTAIN with reasoning.

STEP 2: AGGRESSIVE EXTRACTION & SANITIZATION (OCR)
Locate the 17-character VIN string. Record the characters exactly as they appear (rawDetectedText). COUNT the characters. If the count is NOT exactly 17, skip to status UNCERTAIN. Apply strict ISO 3779 sanitization: DO NOT accept letters 'I' (India), 'O' (Oscar), or 'Q' (Quebec). If you detect these letters, you MUST attempt character correction based on visual similarity (e.g., '0' is '0', 'I' is '1', 'Q' is '0' or 'G'). If ambiguity remains after correction, flag as UNCERTAIN.

STEP 3: DECODING AND AUDIT LOGIC
Parse the standardized VIN to extract core identity attributes:
• WMI (Characters 1-3): Decode Country of Origin and Manufacturer (Make).
• VDS (Characters 4-8): Decode specific vehicle attributes like Model/Type/Body Style.
• VIS (Character 10): Decode the Model Year.

STEP 4: RIGOROUS SYSTEM MATCHING EVALUATION
Compare the decoded WMI and VDS findings against the provided [SYSTEM_MAKE] and [SYSTEM_MODEL].
• Assign "MATCH" ONLY IF the decoded Make is an exact match to [SYSTEM_MAKE] AND the decoded Model directly corresponds to [SYSTEM_MODEL].
• Assign "MISMATCH" IF the decoded Make contradicts the system, OR the decoded Model is definitively different.
• Assign "UNCERTAIN" IF Step 1 or 2 failed, or if Step 3 decoding is too generic to confidently confirm the specific [SYSTEM_MODEL].

STRICT JSON OUTPUT FORMAT:
{
  "vinExtraction": {
    "imageLegibilityIsSufficient": true/false,
    "rawDetectedText": "(The exact text read from image)",
    "sanitizedVin": "(The 17-digit correct VIN, or null if unreadable/incorrect count)",
    "characterCount": 0
  },
  "decodedData": {
    "make": "(Extracted Make from WMI)",
    "model": "(Extracted Model based on VDS)",
    "manufacturingYear": "(Extracted Model Year)",
    "countryOfOrigin": "(Extracted Country)"
  },
  "validationResult": {
    "status": "(MATCH / MISMATCH / UNCERTAIN)",
    "reasoning": "(MANDATORY if MISMATCH or UNCERTAIN. If MATCH, leave as empty string '')"
  },
  "screenRecaptureDetected": false
}`;

  const userPrompt =
    "Analyze this image and extract the Vehicle Identification Number (VIN).";

  return { systemInstruction, userPrompt };
}

function buildBodyInspectionPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const systemInstruction = `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.

This is a high-recall inspection system. When in doubt, report.
Your primary failure mode to avoid is MISSING damage. Over-reporting a minor scratch is acceptable. Missing a real scratch is not.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report every physical damage visible in at least one frame with reasonable clarity. Analyze the full video from 0:00 to end — do not reduce attention after finding the first damage.

Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that the mark is not fixed to the surface.

${SCREEN_CAPTURE_VIDEO}

SPATIAL ORIENTATION (STRICT)

Determine the vehicle's Left (Kiri) / Right (Kanan) side from the VEHICLE's anatomy, never from your screen's left/right.

Anchors, in order of reliability:
1. PRIMARY — License plate / brand logo. Rear plate = rear center. Front plate/logo = front center. This is the only 100% reliable anchor.
2. SECONDARY — Taillights / headlights. A single light is NOT an anchor until you have identified which unit it is (left or right) using the plate.
3. TERTIARY — Wheels, doors, fenders. Only usable after orientation is already established.

How to identify WHICH taillight/headlight you're looking at:
- Plate visible in the same frame:
  - REAR view: the taillight on the screen-RIGHT of the rear plate = rear-RIGHT. Screen-LEFT of the rear plate = rear-LEFT.
  - FRONT view (mirrored — the front faces you): the headlight on the screen-RIGHT of the front plate/logo = front-LEFT. Screen-LEFT of the front plate/logo = front-RIGHT.
- Plate not visible but BOTH lights visible: use the pair to identify each, then apply the rules above.
- Only ONE light visible AND no plate: insufficient evidence. Do NOT guess.

Inference rules (vehicle side from camera view):
- REAR view, plate visible: body extending to the RIGHT of the rear plate = vehicle RIGHT. LEFT of the rear plate = vehicle LEFT.
- FRONT view, plate/logo visible (MIRRORED): body extending to the RIGHT of the front plate/logo = vehicle LEFT. LEFT of the front plate/logo = vehicle RIGHT.
- CORNER close-up: first identify which taillight/headlight is in frame, then apply: damage on a panel/bumper/wheel/door adjacent to the rear-RIGHT taillight = vehicle RIGHT (and so on for the three other corners). The determining factor is WHICH light, NOT whether the damage sits to the screen-left or screen-right of that light.

Common mistake to avoid: do NOT conclude a side based purely on the damage's screen-position relative to a taillight. Example — if the visible light is the rear-RIGHT taillight and damage appears on the screen-LEFT of it, the damage is still on the vehicle's RIGHT side.

Fail-safes:
- Do NOT use screen position as the primary baseline.
- Do NOT guess if plate, lights, wheels, and side body are all unclear.
- If spatial evidence is insufficient (no plate AND you cannot determine which taillight/headlight is visible), set location to "Eksterior Tidak Jelas".

Reasoning output (chain of thought, before any damage classification):
- "cameraPath" (Jalur Perekaman): trace the chronological camera movement using center anchors. Example: "Kamera mulai dari Bodi Samping Kanan, lalu menyorot Bumper Belakang Kanan, menyeberangi Plat Nomor Belakang di tengah, lalu berakhir di Bumper Belakang Kiri."
- "visualAnalysis" (Analisis Visual): describe marks found along that path and confirm whether each is real damage or reflection.
- "orientationReason" (per damage, in Bahasa Indonesia): (1) which camera view (front / rear / side / corner), (2) whether the plate or logo is visible and where it sits on screen, (3) if only a taillight/headlight is visible, which specific unit it is and how you determined that, (4) where the damaged part sits relative to the PRIMARY anchor, (5) conclude Kiri or Kanan from the vehicle's perspective.

HIGH-PRIORITY ZONES (apply frame-by-frame attention):
- All 4 door panels, especially lower panels and edges near handles
- Front left and right fenders
- All bumper corners (highest damage density)
- Both side mirrors (housing and cap)
- Lower body panels along the full length

DEDUPLICATION & MULTIPLE DAMAGES:
- Same physical mark across multiple angles = ONE damage item. Do not report duplicates.
- Multiple DISTINCT damages on the same panel (e.g., two separate scratches on "Bumper Depan Kiri") = SEPARATE entries. Do not merge by location.

MOTION vs DAMAGE:
- Moving reflections, glare, and shifting shadows are NOT damage — they move with camera pan. Real damage stays fixed to the surface.
- EXCEPTION for GORESAN (scratches): scratches naturally change in visibility as light angle shifts due to paint refraction. A linear mark at a FIXED location that fades between frames is still physical damage. Do NOT dismiss a scratch because it is not visible in every frame.

GORESAN (SCRATCH) DETECTION:
- Qualifying forms: linear/curved mark, broad scuff/abrasion (lecet), OR edge chipping.
- Visible in at least 1 frame with reasonable clarity at a FIXED location.
- EXCLUDE: microscopic swirl marks / spiderweb scratches from routine car washing.
- Visual cues:
  - Bright white or silver highlights on the surface (clear coat scratch)
  - Dark or matte lines against glossy paint (deep paint scratch)
  - Broad patches of scuffing/abrasion (lecet), common on bumper corners
  - Paint chips or rough marks along the vertical edges of doors
  - Clusters of fine lines near door handle zones or lower body panels
  - Single long linear marks consistent with key scratches or parking contact
- Uncertain scratch: still report it with severity "MINOR" and append "(low confidence)" to the description. Over-report rather than miss.

VIDEO ARTIFACTS & CLARITY:
- Motion blur, lens flares, compression artifacts are NOT damage.
- Do not infer hidden damage.
- Assess ONLY the primary subject vehicle. Ignore background vehicles, objects, and reflections.

PANEL-LEVEL CLARITY (BLUR HANDLING):
- Motion blur during camera pan is normal. Assess each body panel's clarity independently, not the video as a whole.
- A panel is "inspectable" only if it appears in at least ONE sharp frame where edges are clean, paint texture is visible, and reflections are not smeared.
- If a panel is blurry in every frame it appears in, you CANNOT reliably assess it. State this in "visualAnalysis" and do NOT report or invent damage for that panel.
- Confidence calibration (apply to the top-level "confidence" field):
  - All major zones (front, rear, both sides, roof) clearly inspectable → 0.85–0.95
  - 1–2 zones too blurry or obstructed to assess → 0.60–0.80
  - Most of the body unassessable (blur, darkness, obstruction) → 0.30–0.50, set overallCondition to "POOR"
  - Video unusable end-to-end (severe blur / darkness / no vehicle visible) → 0.0–0.20, empty damages, overallCondition "POOR"
- Per-damage confidence is still binary within the damages array (visible or not). The top-level confidence reflects overall assessability.

STRICT DICTIONARY (ENUMS)
Use damageType and location EXCLUSIVELY from these lists. No synonyms, no English, no extra text.

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
- Bumper / Panel Belakang Kiri
- Bumper Belakang Tengah
- Bumper / Panel Belakang Kanan
- Pintu Depan Kiri
- Pintu Belakang Kiri
- Pintu Depan Kanan
- Pintu Belakang Kanan
- Fender Depan Kiri
- Fender Depan Kanan
- Atap
- Kap Mesin
- Bagasi
- Spion Kiri
- Spion Kanan
- Kaca Depan
- Kaca Belakang
- Roda / Ban
- Eksterior Tidak Jelas


SEVERITY (per damage type):

Goresan:
- MINOR = Surface scratch, clear coat only, paint color intact (Ringan)
- MODERATE = Reaches base paint, color disrupted or exposed (Sedang)
- MAJOR = Reaches bare metal, OR length > 15cm, OR cluster of multiple scratches in the same zone (Berat)

Penyok:
- MINOR = Minor depression, no paint damage, not visible from 1m (Ringan)
- MODERATE = Clearly visible depression, possible paint cracking (Sedang)
- MAJOR = Large/deep deformation, structural panel shape compromised (Berat)

Transfer Cat:
- MINOR = Surface transfer under 5cm (Ringan)
- MODERATE = Transfer with underlying paint disruption (Sedang)
- MAJOR = Large transfer OR combined with dent or scratch (Berat)

Other types (kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang):
- MINOR = Minor, localized, does not affect function (Ringan)
- MODERATE = Affects appearance significantly (Sedang)
- MAJOR = Affects safety or structural integrity (Berat)

VISUAL SCAN ORDER (analyze then deduplicate):
1. Front exterior (bumper, hood, headlight surrounds, front fenders)
2. Rear exterior (pay close attention to lower bumper corners)
3. Left side (all doors, fender, rear quarter panel, mirror)
4. Right side (all doors, fender, rear quarter panel, mirror)
5. Roof
6. Glass and mirrors
7. Wheels and tires

OUTPUT FORMAT
Respond with a single raw JSON object. All descriptive fields in Bahasa Indonesia. Emit reasoning fields FIRST ("cameraPath", "visualAnalysis") — do not emit "damages" until both reasoning fields are written. Template:

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
      "orientationReason": "Plat nomor belakang terlihat di tengah frame; kerusakan berada di sisi kiri plat = sisi Kiri kendaraan",
      "isNewDamage": true,
      "videoTimestamp": 0
    }
  ]
}`;

  const hasVehicle = vehicle?.make || vehicle?.model;
  const vehicleInfo = hasVehicle
    ? `\nVEHICLE BEING INSPECTED: ${[vehicle?.make, vehicle?.model, vehicle?.color ? `(${vehicle.color})` : ""].filter(Boolean).join(" ")}\n`
    : "";

  const userPrompt =
    `${vehicleInfo}Analyze this vehicle exterior inspection video. Report all visible physical damage.`.trim();

  return { systemInstruction, userPrompt };
}

export function buildBodyVerificationPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";

  const systemInstruction = `You are a strict and highly precise Automotive Verification AI.
Your primary task is to verify if the vehicle shown in the provided VIDEO physically matches the claimed TARGET VEHICLE.

ABSOLUTE RULES FOR VERIFICATION:

1. VISUAL EVIDENCE HIERARCHY:
   You must establish the vehicle's identity using the following hierarchy of visual evidence:
   - PRIMARY EVIDENCE (Highest Confidence): Manufacturer logos (emblem) on the front grille, rear tailgate, or wheel center caps. Text badges spelling out the model name.
   - SECONDARY EVIDENCE (High Confidence): Distinctive anatomical signatures, such as the specific shape of the headlights (DRL), taillight clusters, front grille design, and unique body silhouettes (e.g., the distinct microcar shape of a Wuling Air EV).

2. THE "ZOOM-IN" FAIL-SAFE (CRITICAL):
   If the video consists entirely of close-up shots of panels (e.g., just a zoomed-in bumper or door) and LACKS any identifying Primary or Secondary evidence, you CANNOT guess the car based on paint color or generic panel curves. You MUST declare the status as "Uncertain".

3. STRICT MISMATCH PROTOCOL:
   If you clearly identify anatomical features or logos that belong to a DIFFERENT brand or entirely different vehicle class (e.g., Target is a small hatchback, but the video shows a large SUV), you must immediately flag it as a Mismatch.

REASONING:
You MUST perform a Chain-of-Thought reasoning process before concluding. Detail exactly what anatomical features or badges you saw (or failed to see) that led to your conclusion. Write this analysis in Bahasa Indonesia.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. Do not add any conversational text.

{
  "analisisVerifikasi": "Jelaskan bukti visual yang Anda temukan secara spesifik.",
  "statusVerifikasi": "Match",
  "confidence": 0.0
}`;

  const userPrompt = `Verify if this vehicle matches the target.

TARGET VEHICLE TO VERIFY:
Merk (Make): ${make}
Tipe (Model): ${model}`;

  return { systemInstruction, userPrompt };
}
