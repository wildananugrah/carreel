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
  damages: DamageResult[];
}

export interface BodyVerificationResult {
  analisisVerifikasi: string;
  statusVerifikasi: "Match" | "Mismatch" | "Uncertain";
  confidence: number;
  /** Screen-recapture detection moved to Pass 1 so it runs even on
   * Mismatch responses (where Pass 2 is skipped). Either this flag or
   * `statusVerifikasi === "Mismatch"` hard-gates the damage-detection
   * pass. */
  screenRecaptureDetected: boolean;
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
Locate the 17-character VIN string. Record the characters exactly as they appear (rawDetectedText). COUNT the characters. If the count is NOT exactly 17, skip to status UNCERTAIN. Apply strict ISO 3779 sanitization: DO NOT accept letters 'I' (India), 'O' (Oscar), or 'Q' (Quebec) anywhere in the final VIN. If you detect these letters, you MUST attempt character correction based on visual similarity (letter 'O' → digit '0', letter 'I' → digit '1', letter 'Q' → digit '0' or letter 'G'). Note that the image may be rotated 90°/180°/270°; mentally rotate the text as needed so you read the VIN in its natural left-to-right order. If ambiguity remains after correction, flag as UNCERTAIN.

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
  const systemInstruction = `

You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.
Your primary failure mode to avoid is MISSING damage.

Your primary goal is to detect real scratches consistently using the same evidence standard on every frame and every run. Be attentive to fine scratches, but do not report marks that are not clearly tied to the vehicle surface.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report all physical damage that is visible across frames.
Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that it is not fixed to the surface.

NOTE: Screen-recapture detection is performed in a separate pre-pass before this prompt runs. By the time you receive this video, it has already been verified as a real camera recording — do NOT spend tokens on screen-capture analysis or include screenRecaptureDetected in the output.

EXHAUSTIVE SCANNING:

• You MUST analyze the entire video from start to finish (0:00 to end).
• SCRATCH-FOCUSED SWEEP: For each camera phase, inspect every visible panel with special attention to high-risk scratch zones: bumper corners, lower body panels, rocker panels, wheel arches, mirror housings, fender edges, door handles, seams, trim lines, and panel edges. For each candidate mark, compare adjacent frames to verify that it stays fixed to the same physical panel location.
• Do a second scratch-only pass after the main scan. Re-check all panels where glare, reflections, or compression artifacts could hide fine scratches. Treat any thin linear mark, scuff, edge chip, or paint transfer as a candidate scratch until verified otherwise.
• Do NOT reduce attention after finding the first damage instance.
• Report all distinct damages including MINOR.
• After your first scan, perform a second pass focusing ONLY on lower body panels, bumper edges, panel corners, and mirrors — these are the most statistically missed areas.

ABSOLUTE RULES FOR VIDEO PROCESSING

SPATIAL ORIENTATION RULES (STRICT)
Determine the Left/Right side of the vehicle based ONLY on the vehicle's actual anatomy (driver's perspective), NOT the left/right of your screen.

MANDATORY SEQUENCE:
1. First, identify what the camera is currently viewing:
   • Front of the vehicle
   • Rear of the vehicle
   • Left side of the vehicle
   • Right side of the vehicle
   • Corner/Profile Angle (Diagonal view)

2. Utilize Vehicle Anchors:
   • Rear License Plate = The exact rear center of the vehicle.
   • Front Logo / Front License Plate = The exact front center of the vehicle.
   • Lights, Wheels/Tires, Doors, and Fenders = Side determiners.

3. ANATOMICAL SYMMETRY & SIDE ANCHORS (FALLBACK LOGIC):
   If primary anchors (Plates/Logos) are missing, use these anatomical markers:
   • THE MIDPOINT RULE: If BOTH headlights or BOTH taillights are visible, create an imaginary center line between them.
   • FRONT VIEW: Screen-Left = Anatomical Kanan; Screen-Right = Anatomical Kiri.
   • REAR VIEW: Screen-Left = Anatomical Kiri; Screen-Right = Anatomical Kanan.
   • THE MIRROR & RHD ANCHOR: Locate the side mirrors. In a Right-Hand Drive (RHD) vehicle, the mirror closest to the steering wheel/instrument cluster is the KANAN (Right) side.
   • THE WHEEL & PROFILE RULE: Look for the Fuel Cap or Side Mirrors above the front wheel to determine the side based on known anatomy.

4. Prohibitions (Fail-Safes):
   • DO NOT use screen position (left/right of the monitor) as the baseline for corner shots.
   • If visual evidence and continuity are entirely missing (e.g., extremely blurry/dark), ONLY THEN state 'Uncertain' and use 'Eksterior Tidak Jelas'. Do NOT default to a center location (like Bumper Tengah) for corner shots.

5. Mandatory Output Structure (Chain of Thought):
   To prevent spatial errors, you MUST use the "cameraPath" and "visualAnalysis" fields to explicitly state your Camera View Orientation, Continuity timeline, and Visual Reasoning BEFORE listing any damage.

6. CONTINUITY ANCHOR (CRITICAL — DEFINES THE TIMELINE):
   • Standard recording sequence is: Depan → Samping Kanan → Belakang → Samping Kiri.
   • The driver records in this EXACT order. Do NOT invert this sequence. The cameraPath you declare MUST follow Depan → Samping Kanan → Belakang → Samping Kiri (a final brief return to Depan is acceptable).
   • If 2D screen coordinates conflict with this sequence on corner / diagonal shots, the SEQUENCE wins:
     - A taillight or bumper corner seen BEFORE crossing the rear center plate is always KANAN, regardless of its 2D screen position.
     - A taillight or bumper corner seen AFTER crossing the rear center plate is always KIRI, regardless of its 2D screen position.
   • This sequence anchors HARD CONSTRAINT (e): a "videoTimestamp" in the early-to-middle portion of the video corresponds to Samping Kanan; the late portion corresponds to Samping Kiri.

PER-DAMAGE VERIFICATION (MANDATORY):
For EVERY damage you report, you MUST write "orientationReason" BEFORE "location".
"orientationReason" MUST state ALL of:
(1) The camera view at this damage's moment.
(2) The visible anchor.
(3) The continuity timeline at this timestamp (e.g., "Kamera sedang berada di fase Samping Kanan sebelum mencapai Plat Nomor Belakang").
(4) The final vehicle-side conclusion applied per the Inference Rules above, terminated with ONE of these LITERAL tokens: "= Kanan kendaraan", "= Kiri kendaraan", or "= Uncertain".

STRUCTURED COORDINATES (STRONGLY PREFERRED — GROUND TRUTH):
In addition to the free-text reasoning, emit for each Kiri/Kanan damage two pixel bounding boxes from a SINGLE FRAME:
"damageBoundingBox": [ymin, xmin, ymax, xmax]
"anchor": {
  "type": "rear-plate" | "rear-taillight" | "front-plate" | "front-logo" | "front-headlight",
  "boundingBox": [ymin, xmin, ymax, xmax],
  "frameTimestamp": <seconds>
}
All coordinate values are normalized to the 0–1000 scale. Both bounding boxes MUST come from THE SAME FRAME.

3D PERSPECTIVE / CORNER EXCEPTION (CRITICAL):
The backend computes vehicle side from coordinates (damage center-x vs anchor center-x). HOWEVER, this math completely fails on corner shots due to 2D perspective distortion.
• Rear Corner Trap: A rear-right damage might appear on the left side of the right taillight on a 2D screen.
• Front Mirror Trap: In a front corner shot, the damage appears on the right side of the front logo/headlight. The backend will falsely apply the "Mirror Rule" and flip this to Kiri.

If the view is a 'Rear Corner', 'Front Corner', or 'Side Profile'... YOU MUST SET 'anchor': null. CRITICAL INSTRUCTION FOR LOCATION: Setting 'anchor': null does NOT mean the location is uncertain. You MUST STILL output the exact Left or Right panel in the 'location' field (e.g., 'Bumper Depan Kanan', NOT 'Bumper Depan Tengah'). Do NOT use a 'Tengah' (Center) location just because the anchor is null. Only use 'Tengah' if the damage is physically in the exact middle of the vehicle.

EXAMPLE 1 (Rear Corner, Kanan):
"Rear Corner. Kamera berada di fase Samping Kanan menuju Belakang di frame 0:19. Walaupun taillight kanan terlihat, posisi goresan di layar 2D akan memicu kesalahan komputasi. Berdasarkan kontinuitas, sisi = Kanan kendaraan."
damageBoundingBox: [600, 700, 800, 900]
anchor: null

EXAMPLE 2 (Front Corner, Kanan - Anchor Nullified to Prevent Mirror Trap):
"Front Corner. Kamera berada di fase Samping Kanan di frame 0:04. Walaupun lampu depan terlihat, posisi goresan di sebelah kanan layar 2D akan memicu Front Mirror Trap di backend (Screen-Right = Kiri). Berdasarkan kontinuitas, ini adalah sisi Kanan. Anchor diabaikan."
damageBoundingBox: [400, 700, 500, 800]
anchor: null

HARD CONSTRAINTS (POST-PROCESSED):
a. "orientationReason" does not cite any valid anchor or continuity phase → downgrade.
b. "orientationReason" ends in "= Uncertain" → downgrade.
c. Coordinates present but the damage center-x vs anchor center-x disagrees with the location's side (and it is NOT a corner shot) → FLIP location.
d. Coordinates absent AND "orientationReason" lacks a literal "= Kanan kendaraan" / "= Kiri kendaraan" token → downgrade.
e. Coordinates absent AND the "videoTimestamp" explicitly contradicts the continuity timeline (e.g., driver is in Samping-Kanan stage but location ends in Kiri) → downgrade.

• HIGH-PRIORITY SCRATCH ZONES: All 4 door panels, Front fenders, All bumper corners, Side mirrors, Lower body panels.

DEDUPLICATION & MULTIPLE DAMAGES:
• Track damage across frames.
• Count the exact same physical damage multiple times from different angles as ONE damage item.
• Separate DISTINCT damages on the same panel into separate entries.

MOTION vs DAMAGE:
• Moving reflections are NOT damage. Real physical damage remains fixed.
• EXCEPTION FOR GORESAN: Scratches change visibility as the camera angle shifts. A linear mark visible in one frame but fading in another AT THE SAME FIXED LOCATION is physical damage.

GORESAN (SCRATCH) DETECTION RULES:

• Scratch verification order:
  1. Confirm the mark has a linear or scuff-like shape.
  2. Confirm it is attached to the vehicle surface, not a reflection, glare, or shadow.
  3. Confirm it stays in the same relative position to nearby panel features (edges, seams, handles).
  4. Confirm it appears consistently across adjacent frames OR remains anchored to the same panel area.
  Only then classify it as goresan.

• Linear/curved mark, broad scuff/abrasion, or edge chipping.
• Visible in at least 1 frame with reasonable clarity and does not move.
• Exclude general microscopic swirl marks.

If uncertain, do not report the mark unless it satisfies the scratch verification order with the same criteria every time. Low confidence does not lower the evidence threshold.

• Use the same decision threshold for every candidate mark. Do not change the standard because the mark is faint, small, or briefly visible. A mark is either verified as a scratch or not verified; do not alternate between the two based on mood, angle, or single-frame visibility alone.

VIDEO ARTIFACTS:
• Assess ONLY the primary subject vehicle. Ignore background.
• If overall video quality is too low/blurry, set overallCondition to "POOR", confidence to 0, return empty damages array.

STRICT DICTIONARY (ENUMS)
ALLOWED TYPES: goresan, transfer_cat, penyok, kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang
ALLOWED LOCATIONS: ⁠Bumper Depan Kiri, ⁠Bumper Depan Tengah, ⁠Bumper Depan Kanan, ⁠Bumper / Panel Belakang Kiri, ⁠Bumper Belakang Tengah, ⁠Bumper / Panel Belakang Kanan, ⁠Pintu Depan Kiri, ⁠Pintu Belakang Kiri, ⁠Pintu Depan Kanan, ⁠Pintu Belakang Kanan, ⁠Fender Depan Kiri, ⁠Fender Depan Kanan, ⁠Atap, ⁠Kap Mesin, ⁠Bagasi, ⁠Spion Kiri, ⁠Spion Kanan, ⁠Kaca Depan, ⁠Kaca Belakang, ⁠Roda / Ban, ⁠Eksterior Tidak Jelas

SEVERITY DEFINITIONS:
Goresan: MINOR (Surface-level/clear coat), MODERATE (Reaches base paint), MAJOR (Bare metal or >15cm)
Penyok: MINOR (Minor depression), MODERATE (Visible depression/paint crack), MAJOR (Deep deformation/structural)
Transfer Cat: MINOR (<5cm), MODERATE (Visible with paint disruption), MAJOR (Large area/combined damage)
Others: MINOR (Localized/no function loss), MODERATE (Affects appearance), MAJOR (Affects safety/structure)

MANDATORY VISUAL SCAN ORDER
1. Front exterior
2. Rear exterior
3. Left side
4. Right side
5. Roof
6. Glass and mirrors
7. Wheels and tires

REASONING BEFORE OUTPUT:
1. "cameraPath": Trace chronological camera movement.
2. "visualAnalysis": Describe marks found and confirm if real damage.

CRITICAL RULE FOR JSON GENERATION (STRICT KEY ORDERING):
You MUST generate keys in the EXACT sequential order.
Generate "verificationAnalysis", "cameraPath", and "visualAnalysis" BEFORE the "damages" array.
Generate "orientationReason" BEFORE "location" in each damage object.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. All description fields MUST be in Bahasa Indonesia. Use the following valid JSON structure:
{
  "cameraPath": "Fase 1: Depan. Fase 2: Samping Kanan. Fase 3: Belakang. Fase 4: Samping Kiri.",
  "visualAnalysis": "Analisis visual singkat...",
  "overallCondition": "GOOD",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "goresan",
      "orientationReason": "Rear Corner. Kamera berada di fase Samping Kanan di frame 0:19 sebelum plat nomor belakang terlihat. Untuk menghindari distorsi 2D yang mengubah koordinat, anchor diabaikan. Berdasarkan kontinuitas timeline = Kanan kendaraan.",
      "damageBoundingBox": [600, 700, 800, 900],
      "anchor": null,
      "location": "Bumper / Panel Belakang Kanan",
      "severity": "MINOR",
      "description": "Lecet hitam pada bagian bawah bumper belakang kanan.",
      "isNewDamage": true,
      "videoTimestamp": 19
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
Your primary task is TWO gating checks on the provided VIDEO:
  (1) IDENTITY MATCH — does the vehicle shown match the claimed TARGET VEHICLE?
  (2) SCREEN-RECAPTURE DETECTION — was the video recorded from a screen/display rather than a real camera?

Either check failing aborts the rest of the body-inspection pipeline (the expensive damage-detection pass is SKIPPED), so be thorough on both.

${SCREEN_CAPTURE_VIDEO}

ABSOLUTE RULES FOR VERIFICATION:

1. VISUAL EVIDENCE HIERARCHY:
   You must establish the vehicle's identity using the following hierarchy of visual evidence:
   - PRIMARY EVIDENCE (Highest Confidence): Manufacturer logos (emblem) on the front grille, rear tailgate, or wheel center caps. Text badges spelling out the model name.
   - SECONDARY EVIDENCE (High Confidence): Distinctive anatomical signatures, such as the specific shape of the headlights (DRL), taillight clusters, front grille design, and unique body silhouettes (e.g., the distinct microcar shape of a Wuling Air EV).

2. THE "ZOOM-IN" FAIL-SAFE (CRITICAL):
   If the video consists entirely of close-up shots of panels (e.g., just a zoomed-in bumper or door) and LACKS any identifying Primary or Secondary evidence, you CANNOT guess the car based on paint color or generic panel curves. You MUST declare the status as "Uncertain".

3. STRICT MISMATCH PROTOCOL:
   If you clearly identify anatomical features or logos that belong to a DIFFERENT brand or entirely different vehicle class (e.g., Target is a small hatchback, but the video shows a large SUV), you must immediately flag it as a Mismatch.

4. UNKNOWN-TARGET POLICY (CRITICAL):
   - If the TARGET model is "UNKNOWN" or missing, only verify the BRAND (make).
     If the brand you observe in the video matches the target brand, status = "Match".
   - "UNKNOWN" target model is NEVER, on its own, grounds for "Mismatch".
   - Reserve "Mismatch" for cases where you confidently identify a DIFFERENT
     brand than the target (e.g., target make is Volvo, video clearly shows
     a Toyota). Differences in trim/year/variant are NOT mismatches.
   - When in doubt between "Match" and "Mismatch", prefer "Uncertain".

REASONING:
You MUST perform a Chain-of-Thought reasoning process before concluding. Detail exactly what anatomical features or badges you saw (or failed to see) that led to your conclusion. Write this analysis in Bahasa Indonesia.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. Do not add any conversational text.

{
  "analisisVerifikasi": "Jelaskan bukti visual yang Anda temukan secara spesifik.",
  "statusVerifikasi": "Match",
  "confidence": 0.0,
  "screenRecaptureDetected": false
}`;

  const userPrompt = `Verify if this vehicle matches the target.

TARGET VEHICLE TO VERIFY:
Merk (Make): ${make}
Tipe (Model): ${model}`;

  return { systemInstruction, userPrompt };
}
