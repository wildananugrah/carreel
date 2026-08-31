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
  /** Per-damage confidence (0–1). Distinct from the global response
   * confidence — used for borderline/uncertain detections. */
  damageConfidence?: number;
  /** "clear" | "borderline" — signals how confidently the mark was
   * identified as a real physical damage. */
  visibilityLevel?: string;
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

export interface PhotoBodyDamage {
  damageType: string;
  location?: string;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  description: string;
  /** Which of the 8 photos this damage was seen on. */
  bodySide:
    | "FRONT"
    | "FRONT_RIGHT"
    | "RIGHT"
    | "BACK_RIGHT"
    | "BACK"
    | "BACK_LEFT"
    | "LEFT"
    | "FRONT_LEFT";
  isNewDamage: boolean;
  damageConfidence?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface PhotoBodyInspectionResult {
  visualAnalysis: string;
  overallCondition: "GOOD" | "FAIR" | "POOR";
  confidence: number;
  damages: PhotoBodyDamage[];
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
  /**
   * Photo path only — how sure the model is about the recapture call itself
   * (0-1), independent of `confidence`, which scores the identity decision.
   * Optional so a response from the video prompt still parses.
   */
  recaptureConfidence?: number;
  /**
   * Photo path only — the specific cues the recapture call rests on. Surfaced
   * verbatim in the planner's SCREEN_RECAPTURE alert so the decision is
   * auditable instead of an unexplained boolean.
   */
  recaptureIndicators?: string[];
}

/**
 * Result of `buildDamageEvidencePhotoVerificationPrompt` — verifies a
 * driver-captured still photo before the damage row is committed to the
 * inspection. Two gating checks bundled in one Gemini call:
 *   - `screenRecaptureDetected` — was the photo recaptured from a screen?
 *   - `vehicleMismatchDetected` — does the vehicle in the photo match
 *     the inspection's claimed brand/model?
 */
export interface DamageEvidencePhotoVerificationResult {
  analysis: string;
  screenRecaptureDetected: boolean;
  vehicleMismatchDetected: boolean;
  /** "Uncertain" when there is too little vehicle evidence in the photo to
   * judge identity (e.g. extreme close-up of a panel). Treated by the
   * service layer as PASSED — we don't penalize legitimate close-ups. */
  identityConfidence: "High" | "Low" | "Uncertain";
  reasoning: string;
}

/**
 * Why the driver's photo could not be read, as a closed enum rather than
 * prose. The driver-app maps these to Indonesian copy, so the wording
 * shown on the phone stays under our control instead of varying with
 * whatever sentence the model produced.
 */
export type OdometerPrecheckReason =
  | "OK"
  | "NOT_IN_FRAME"
  | "BLURRY"
  | "GLARE"
  | "DASHBOARD_OFF"
  | "TRIP_ONLY";

export type FuelPrecheckReason =
  | "OK"
  | "GAUGE_NOT_IN_FRAME"
  | "GAUGE_BLURRY"
  | "GLARE"
  | "DASHBOARD_OFF"
  | "LEVEL_AMBIGUOUS"
  | "NO_GAUGE_ON_VEHICLE";

export type FuelGaugeType =
  | "ANALOG_NEEDLE"
  | "DIGITAL_BAR"
  | "DIGITAL_PERCENT"
  | "NONE";

/**
 * Result of the in-camera dashboard pre-check. This is transient guidance
 * shown to the driver before the photo is uploaded — it is never persisted.
 * The stored odometerKm/fuelLevelPct still come from the full SPEEDOMETER
 * analysis in StepAnalysisJob.
 */
export interface DashboardPrecheckAIResult {
  dashboardLit: boolean;
  odometer: {
    readable: boolean;
    valueKm: number | null;
    reasonCode: OdometerPrecheckReason;
  };
  fuel: {
    gaugeFound: boolean;
    readable: boolean;
    gaugeType: FuelGaugeType;
    valuePct: number | null;
    reasonCode: FuelPrecheckReason;
  };
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

/**
 * Screen-recapture protocol for the 8-photo EXTERIOR body inspection.
 *
 * Deliberately NOT `SCREEN_CAPTURE_IMAGE`: that one is written for the
 * SPEEDOMETER step and reasons about dashboards, steering wheels and analog vs
 * digital clusters. Reused on an exterior walkaround its headline indicators
 * ("rounded corners", "uniform dark padding", "photo-within-a-photo") have no
 * valid meaning, and its "when in doubt, classify as true" policy made the
 * model manufacture those cues — a real Toyota Calya set was rejected as
 * screenshots while the same response scored the identity Match at 0.98
 * (docs/lessons.md, 2026-08-21).
 *
 * This variant is tuned for precision instead: the caller treats the result as
 * advisory (it raises a planner alert, it does not fail the driver), so
 * converging evidence beats a hair trigger.
 */
/**
 * Canonical walk-around order, and the fallback when a caller does not say
 * which sides it actually has. A workspace can require fewer than all eight
 * (Workspace.requiredBodySides), so the photo prompts below must describe the
 * set they were really given — telling the model "EIGHT photos" while handing
 * it four is a live accuracy risk, not a cosmetic mismatch.
 */
const ALL_BODY_SIDES = [
  "FRONT",
  "FRONT_RIGHT",
  "RIGHT",
  "BACK_RIGHT",
  "BACK",
  "BACK_LEFT",
  "LEFT",
  "FRONT_LEFT",
];

const COUNT_WORDS = [
  "ZERO",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
];

/** Spelled-out count, matching the emphatic register of the prompt text. */
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function photoNoun(n: number): string {
  return n === 1 ? "photo" : "photos";
}

const SCREEN_CAPTURE_EXTERIOR = `
[SCREEN-CAPTURE DETECTION PROTOCOL — EXTERIOR VEHICLE PHOTOS]

GOAL:
Decide whether these photos were taken with a real camera pointed at a real
vehicle, or re-captured from a screen / printout / saved screenshot.

CALIBRATION (READ FIRST):
These are outdoor or workshop photos of a car's exterior, taken handheld on a
phone. Expect messy, imperfect framing. That is NORMAL and is NOT evidence of
recapture.

DECISIVE INDICATORS (any ONE is enough to conclude recapture):
D1. A physical device is visible in frame: monitor bezel, phone body, laptop
    lid, tablet edge, or a printed page's paper edge.
D2. Operating-system or application chrome is visible: status bar with clock or
    battery, navigation buttons, browser toolbar, app header, cursor, scrollbar,
    or a watermark/timestamp overlay drawn by another app.
D3. A clear moiré / subpixel grid across the VEHICLE ITSELF (not merely on a
    small reflective surface such as a headlight lens or window glass).
D4. The vehicle is unmistakably contained inside a smaller inner rectangle that
    has its own visible frame, with unrelated content outside it.

SUPPORTING INDICATORS (need at least TWO, together, to conclude recapture):
S1. The whole scene is on one flat focal plane with no perspective change
    between the near and far ends of the car across the set.
S2. Specular hotspot or brightness falloff shaped like a rectangular panel,
    inconsistent with the scene's own light sources.
S3. Every photo in the set shares an identical border geometry, as if they were
    all cropped from the same frame.
S4. Visible banding/posterization typical of a re-encoded display capture,
    present uniformly across every photo in the set.

EXPLICITLY NOT EVIDENCE — never flag on these alone:
- Dark or black regions at the top or bottom of the frame. Workshop ceilings,
  shadow under the car, asphalt, and night sky all produce these. They are NOT
  letterboxing.
- Any aspect ratio. Phones produce 4:3, 16:9, 1:1 and cropped frames alike.
- Rounded or soft frame corners. Lens vignetting, a dirty lens, and JPEG
  artifacts all soften corners. A real photo can absolutely have dark, soft
  corners.
- Straight, clean edges where the vehicle meets a wall, floor line, or door.
- Glare or reflections on paint, glass, or chrome — these are expected on a car.
- Blur, low resolution, or heavy JPEG compression on their own.
- Photos that look similar to each other, or a plate/sticker visible on the car.

DECISION RULE:
- One decisive indicator (D1-D4) → screenRecaptureDetected = true.
- Two or more supporting indicators (S1-S4) → screenRecaptureDetected = true.
- A single supporting indicator, a vague impression, or nothing from the lists
  above → screenRecaptureDetected = false.
- Do NOT default to true when unsure. If you cannot name the specific indicator
  code you relied on, the answer is false.

REPORTING:
Populate "recaptureIndicators" with the codes you actually relied on (e.g.
["D2"], ["S1","S3"]) — leave it as [] when the answer is false.
"recaptureConfidence" is the probability that these photos ARE a recapture:
0.0 = certainly a real camera photo, 1.0 = certainly recaptured. It must stay
below 0.5 whenever screenRecaptureDetected is false.
`;

/**
 * Screen-recapture protocol for the body-inspection WALKAROUND VIDEO.
 *
 * The video counterpart of `SCREEN_CAPTURE_EXTERIOR`, and rewritten for the
 * same reason (docs/lessons.md, 2026-08-21). The previous version fired on
 * "any single one" of eight loose cues, led with "Rectangular screen boundary,
 * bezel, frame, or black border" — which a letterboxed phone recording has by
 * construction — and closed with a blank cheque: "Even if no obvious artifacts
 * are visible, still classify as true if the scene strongly resembles a
 * recorded display." Wired to a terminal gate that dead-ends drivers.
 *
 * A walkaround video carries one genuinely strong signal a screen recording
 * cannot fake: parallax. Lean on that instead of a hair trigger. The caller
 * treats the result as advisory — it raises a planner alert, it does not fail
 * the driver.
 */
const SCREEN_CAPTURE_VIDEO = `
[SCREEN-CAPTURE DETECTION PROTOCOL — EXTERIOR WALKAROUND VIDEO]

GOAL:
Decide whether this video was recorded by a real camera walking around a real
vehicle, or re-recorded from a screen / display / another playback device.

CALIBRATION (READ FIRST):
This is a handheld phone video of a car's exterior, shot outdoors or in a
workshop. Expect shake, uneven exposure, wind noise, fingers at the frame edge
and imperfect framing. That is NORMAL and is NOT evidence of recapture.

THE PARALLAX TEST (your primary tool):
In a real walkaround, near and far objects shift relative to each other as the
camera moves: the background slides behind the car, wheels and mirrors occlude
and reveal parts of the body, and reflections travel across the paint. A video
of a screen cannot produce this — the whole frame moves as one rigid plane.
Judge parallax first; it separates real from recaptured more reliably than any
surface artifact.

DECISIVE INDICATORS (any ONE is enough to conclude recapture):
D1. A physical display is visible in frame: monitor bezel, phone body, laptop
    lid, tablet edge, or TV frame surrounding the content.
D2. Operating-system or application chrome is visible: status bar with clock or
    battery, playback controls, progress bar, navigation buttons, cursor,
    window title bar, or another app's watermark burned into the content.
D3. Refresh interference across the whole frame: rolling horizontal bands or
    pulsing brightness from a shutter/refresh mismatch.
D4. The vehicle is unmistakably contained inside a smaller inner rectangle with
    its own visible frame, with unrelated content outside it.

SUPPORTING INDICATORS (need at least TWO, together, to conclude recapture):
S1. No parallax: the scene moves as one rigid block throughout, with no
    relative shift between foreground and background (see THE PARALLAX TEST).
S2. No focal depth shift anywhere in the clip — everything stays on one focus
    plane even as the camera distance changes.
S3. A moiré / subpixel grid over the VEHICLE ITSELF, not merely on glass,
    chrome, or a headlight lens.
S4. Specular hotspot or brightness falloff shaped like a flat rectangular
    panel, inconsistent with the scene's own light sources.

EXPLICITLY NOT EVIDENCE — never flag on these alone:
- Black bars at the edges of the video. Portrait recordings, letterboxing, and
  aspect-ratio padding all produce these on ordinary phone footage.
- Any aspect ratio or resolution.
- Glare, reflections, or highlights on paint, glass, or chrome — a car is a
  large glossy object and these are expected.
- Camera shake, motion blur, autofocus hunting, or heavy compression.
- Flat or overcast lighting, or a shaded indoor workshop.
- Straight, clean edges where the car meets a wall, floor line, or shutter.
- Sections where the operator holds still or films a panel close up.

DECISION RULE:
- One decisive indicator (D1-D4) → screenRecaptureDetected = true.
- Two or more supporting indicators (S1-S4) → screenRecaptureDetected = true.
- A single supporting indicator, a vague impression, or nothing from the lists
  above → screenRecaptureDetected = false.
- Do NOT default to true when unsure. If you cannot name the specific indicator
  code you relied on, the answer is false.

REPORTING:
Populate "recaptureIndicators" with the codes you actually relied on (e.g.
["D2"], ["S1","S2"]) — leave it as [] when the answer is false.
"recaptureConfidence" is the probability that this video IS a recapture:
0.0 = certainly a real camera recording, 1.0 = certainly recaptured. It must
stay below 0.5 whenever screenRecaptureDetected is false.
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

/**
 * Odometer / fuel-gauge reading rules, shared verbatim between the full
 * SPEEDOMETER analysis and the in-camera dashboard pre-check.
 *
 * These MUST stay a single source of truth: the pre-check tells the driver
 * "the fuel gauge is readable" while still at the vehicle, and the real
 * analysis then produces the stored fuelLevelPct. If the two prompts were
 * allowed to drift, the driver would be told a photo was fine and the
 * analysis would still come back null — the exact failure this feature
 * exists to prevent.
 *
 * Wording is field-name-specific ("set fuelLevelPct to null") because that
 * is the phrasing the SPEEDOMETER prompt was tuned against. The pre-check
 * prompt bridges the naming difference explicitly rather than
 * parameterising these strings, so the tuned text stays untouched.
 */
const ODOMETER_READ_RULES = `- Locate the TOTAL mileage display only.
- Accept only the main odometer, usually labeled "ODO" or shown as the largest mileage number.
- Ignore TRIP A, TRIP B, average fuel economy, outside temperature, clock, gear position, range, and any other secondary display.
- Do NOT confuse odometer with "Range" / estimated distance, speed, RPM, temperature, or fuel percentage.
- Read only digits that are fully visible and unambiguous.
- If the full odometer value cannot be read with certainty, set "odometerKm": null.
- Return the number exactly as displayed, with no rounding.`;

const DIGITAL_DISPLAY_DISAMBIGUATION = `### DIGITAL DISPLAY DISAMBIGUATION — CRITICAL
Digital displays may show many numbers. You MUST classify each visible number before using it.

Examples:
- A number followed by "km" near "ODO" = odometer.
- A number followed by "C", "°C", "F", or "°F" = temperature, NOT fuel.
- A number near "Sekitar", "Outside", "Temp", "Temperature", or "Ambient" = temperature, NOT fuel.
- A number near "km/h" = speed, NOT fuel.
- A number near "TRIP" = trip meter, NOT odometer.
- A number near "RANGE" or distance-to-empty = range, NOT fuel.
- A gear indicator such as P/R/N/D is NOT fuel.
- A digital number is NOT fuel unless it is explicitly attached to a fuel bar, gas pump icon, or fuel percentage display.

Never use a digital temperature number as fuelLevelPct.`;

const FUEL_GAUGE_LOCK_RULES = `CRITICAL FUEL-GAUGE LOCK:
Before reading fuel level, you MUST first locate a confirmed fuel gauge.
A confirmed fuel gauge must have at least one of these fuel-specific anchors visibly attached to it:
- "E" and/or "F" fuel markers
- a gas pump icon
- a vertical or horizontal fuel bar directly next to E/F markers
- a small analog fuel needle directly connected to E/F markers

DO NOT read fuel level from:
- the speedometer needle
- the tachometer/RPM needle
- km/h scale
- x1000 r/min scale
- temperature gauge
- warning lamps
- gear position display
- trip/ODO/range/clock/temperature text

Important:
- Speedometer usually has km/h numbers such as 0, 20, 40, 60, 100, 140, 180, 200, 220. These are NOT fuel.
- Tachometer usually has x1000 r/min or RPM numbers such as 0–8. These are NOT fuel.
- Fuel gauge is usually marked with E/F, a gas pump icon, or a fuel bar beside E/F.
- Some dashboards place the fuel gauge inside the same circular dial as the speedometer. In that case, separate the main speedometer needle from the small fuel needle.
- The speedometer needle is attached to the main center hub and points to km/h numbers.
- The fuel needle/bar is attached to the E/F fuel scale or gas pump icon.
- Only the needle/bar attached to E/F or gas pump icon may be used for fuelLevelPct.

Detection workflow:
1. First scan the entire dashboard specifically for "E", "F", and gas pump icon.
2. If not found on the first scan, scan again more carefully around:
   - inside the speedometer cluster,
   - beside the digital display,
   - lower-left or lower-right small gauges,
   - vertical LCD bar areas.
3. Only after a confirmed fuel gauge is found, determine whether it is:
   - ANALOG NEEDLE fuel gauge, or
   - DIGITAL BAR fuel gauge.

For ANALOG NEEDLE fuel gauge:
- Read only the needle that belongs to the confirmed E/F fuel scale.
- Treat E as 0% and F as 100%.
- Estimate the needle position continuously along the visible E-to-F scale.
- Do NOT force the result into fixed levels such as only 0%, 25%, 50%, 75%, or 100%.
- Use intermediate values when visually appropriate, such as 10%, 15%, 20%, 30%, 35%, 45%, 55%, 60%, 70%, 85%, etc.
- Round to the nearest 5%.
- If the needle is slightly above E, output a low percentage such as 5–15%, not automatically 25%.
- If the needle is between E and half, estimate the proportional position visually.
- If the needle is between half and F, estimate the proportional position visually.
- If the E/F scale or fuel needle is not clearly visible, set fuelLevelPct to null.

For DIGITAL BAR fuel gauge:
- Read only the fuel bar directly associated with E/F markers or gas pump icon.
- Estimate fuel level from the filled portion of the bar relative to the full E-to-F range.
- If individual bars are visible, count filled bars versus total bars and convert proportionally to percentage.
- Do NOT force the result into fixed levels such as only 0%, 25%, 50%, 75%, or 100%.
- Use intermediate values when visually appropriate.
- Round to the nearest 5%.
- If filled bars cannot be distinguished from empty bars, set fuelLevelPct to null.

Low fuel warning lamp rule:
- Do NOT use the low fuel warning lamp to calculate fuelLevelPct.
- A warning lamp only indicates a warning, not the exact fuel percentage.
- Ignore warning lamps when estimating fuel level.

If no confirmed fuel gauge is found after the second scan, set fuelLevelPct to null.
If a fuel gauge is found but the level is unclear, set fuelLevelPct to null.
Do not guess.`;

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
- Dashboard must be illuminated/lit up.
- Digital displays should be active, showing numbers, icons, or indicators.
- Indicator lights or gauges should be in their ON state.
- A completely dark/off dashboard means the vehicle is NOT on.

### 2. Odometer
${ODOMETER_READ_RULES}

${DIGITAL_DISPLAY_DISAMBIGUATION}

### 3. Fuel Level

${FUEL_GAUGE_LOCK_RULES}

### 4. Warning Lights
- Identify only warning lights that are clearly illuminated.
- Do not report icons that are off, reflected, printed, or uncertain.
- If no warning lights are clearly on, return an empty array.
- Use standard names: "check engine", "battery", "oil pressure", "temperature", "ABS", "airbag", "tire pressure", "brake", "door ajar", etc.
- Do not confuse printed icons or unlit symbols with active warning lights.
- A warning light is active only if it is visibly illuminated.

### FINAL VALIDATION BEFORE JSON — CRITICAL

Before finalizing the JSON, verify:

ODOMETER VALIDATION:
- Did "odometerKm" come from the main ODO / total mileage display?
- If the number came from TRIP, range, temperature, speed, RPM, clock, or gear position, set "odometerKm": null.

FUEL VALIDATION:
- Did "fuelLevelPct" come from a gas pump icon, E/F gauge, fuel needle, fuel bar, or explicit fuel percentage display?
- If "fuelLevelPct" was copied from a value like "32C", "32°C", or "Sekitar 32C", it is wrong. Ignore the temperature and re-check the actual fuel gauge.
- If the only visible number is temperature, output "fuelLevelPct": null.
- Do not confuse ambient temperature with fuel level.

WARNING LIGHT VALIDATION:
- Are the reported warning lights clearly illuminated?
- If an icon is only printed, dim, reflected, or uncertain, do not include it.

## Response Format
Respond ONLY with a valid, raw JSON object.
Do NOT wrap the response in markdown code blocks.
Do not add any conversational text.
Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

{
  "odometerKm": null,
  "fuelLevelPct": null,
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
  const systemInstruction = `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.
Your primary failure mode to avoid is MISSING damage.

Your primary goal is to detect real scratches consistently using the same evidence standard on every frame and every run. Be attentive to fine scratches, but do not report marks that are not clearly tied to the vehicle surface.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report all physical damage that is visible across frames.
Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that it is not fixed to the surface.

NOTE: Screen-recapture detection is performed in a separate pre-pass before this prompt runs. By the time you receive this video, it has already been verified as a real camera recording — do NOT spend tokens on screen-capture analysis or include screenRecaptureDetected in the output.

EXHAUSTIVE SCANNING:

• You MUST analyze the entire video from start to finish (0:00 to end).
• SCRATCH-FOCUSED SWEEP: For each camera phase, inspect every visible panel with special attention to high-risk scratch zones: bumper corners, lower body panels, rocker panels, wheel arches, mirror housings, fender edges, door handles, seams, trim lines, and panel edges.
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

   • THE MIDPOINT RULE:
     If BOTH headlights or BOTH taillights are visible in a near-dead-center view, create an imaginary center line between them.

   • FRONT VIEW MIRROR RULE — DEAD-CENTER ONLY:
     Use this rule ONLY when the camera is facing the front of the vehicle almost dead-center and BOTH headlights plus the front center/logo/plate/grille are visible.
     - In dead-center FRONT VIEW only: Screen-Left = Anatomical Kanan; Screen-Right = Anatomical Kiri.
     - Do NOT apply this rule to front-corner, diagonal, close-up, or one-lamp-only views.

   • REAR VIEW RULE — DEAD-CENTER ONLY:
     Use this rule ONLY when the camera is facing the rear of the vehicle almost dead-center and BOTH taillights plus the rear plate/trunk center are visible.
     - In dead-center REAR VIEW only: Screen-Left = Anatomical Kiri; Screen-Right = Anatomical Kanan.
     - Do NOT apply this rule to rear-corner, diagonal, close-up, or one-lamp-only views.

   • LOCAL VEHICLE ANATOMY PRIORITY:
     For corner, diagonal, profile, or close-up shots, determine vehicle side using local anatomy:
     - Vehicle center direction: grille, front logo, front plate, hood center line, rear plate, trunk center.
     - Vehicle outside direction: fender edge, wheel arch, bumper corner, side body curvature.
     Local center/outside anatomy overrides raw screen-left/screen-right assumptions.

   • THE MIRROR & RHD ANCHOR:
     Locate the side mirrors. In a Right-Hand Drive (RHD) vehicle, the mirror closest to the steering wheel/instrument cluster is the KANAN (Right) side.
     Use this only as supporting evidence, not as the primary rule when local lamp/bumper anatomy is visible.

   • THE WHEEL & PROFILE RULE:
     Look for the fuel cap, wheel arch continuity, side body direction, and panel flow to determine the side based on known anatomy.

4. Mandatory Output Structure (Chain of Thought):
   To prevent spatial errors, you MUST use the "cameraPath" and "visualAnalysis" fields to explicitly state your Camera View Orientation, Continuity timeline, and Visual Reasoning BEFORE listing any damage.

5. CONTINUITY ANCHOR (DYNAMIC TIMELINE — CRITICAL):

   • Drivers always start from Depan, but they may walk towards the Kanan side first OR towards the Kiri side first.
   • Do NOT use the steering wheel or mid-video screen-coordinates. Instead, determine the path strictly by observing the FRONT HEADLIGHTS as the camera leaves the 'Depan' phase.
   • THE HEADLIGHT MIRROR RULE (From dead-center front view):
     - The headlight on the LEFT side of the screen = Anatomical KANAN (Right/Driver side).
     - The headlight on the RIGHT side of the screen = Anatomical KIRI (Left/Passenger side).
   • HOW TO DETERMINE THE PATH:
     - Watch which headlight the camera moves towards/past when leaving the initial front view.
     - If the camera moves towards the Screen-LEFT headlight -> It is entering the Sisi KANAN. This is PATH A. (Sequence: Depan → Sisi Kanan → Belakang → Sisi Kiri).
     - If the camera moves towards the Screen-RIGHT headlight -> It is entering the Sisi KIRI. This is PATH B. (Sequence: Depan → Sisi Kiri → Belakang → Sisi Kanan).
   • You MUST explicitly state the headlight movement you observed at the START of the "cameraPath" field.

• Corner-Start Exception: If the video STARTS on a corner instead of dead-center, use the corrected SCREEN-GEOMETRY RULE above for frame 0 to determine your initial side, then track the continuity from there.

   • Example Format: "PATH A. Kamera bergerak melewati lampu depan yang berada di kiri layar (Anatomi Kanan). Fase 1: Depan. Fase 2: Samping Kanan. Fase 3: Belakang. Fase 4: Samping Kiri."

   •If 2D screen coordinates conflict with local vehicle anatomy on corner / diagonal / close-up shots, LOCAL VEHICLE ANATOMY wins.

For lamp, taillight, foglamp, DRL, and lower-front-lamp damage, LOCAL VEHICLE ANATOMY always overrides PATH A/PATH B.

PATH A/PATH B wins only for pure side-profile frames where local center/outside anatomy is not visible.

   • The detected Path anchors HARD CONSTRAINT (e) and drives the CORNER DECISION TREE below.

LAMP / FOGLAMP DAMAGE ORIENTATION OVERRIDE — HIGHEST PRIORITY

For any damage located on or immediately around:
- headlight / lampu depan
- taillight / lampu belakang
- foglamp / fog light / lampu kabut
- DRL
- lower front lamp
- lamp housing
- lamp cover
- lamp corner trim

determine Left/Right using LOCAL VEHICLE ANATOMY first.

Do NOT use PATH A/PATH B, dead-center headlight mirror rule, steering wheel, or coordinate math for lamp/foglamp damage unless local anatomy is not visible.

A. FRONT HEADLIGHT / FRONT LAMP / FOGLAMP / DRL DAMAGE

Use the vehicle center direction:
- grille
- front logo
- front plate area
- hood center line
- center bumper opening

Use the vehicle outside direction:
- fender edge
- wheel arch
- bumper corner
- side body curvature
- outer edge of the lamp/foglamp housing

For front corner, diagonal, or close-up views:

- If the vehicle center/grille/front bumper center is on the RIGHT side of the image and the outside fender/wheel/bumper corner is on the LEFT side of the image, the damaged headlight/foglamp/DRL is on the vehicle's RIGHT side = Kanan kendaraan.

- If the vehicle center/grille/front bumper center is on the LEFT side of the image and the outside fender/wheel/bumper corner is on the RIGHT side of the image, the damaged headlight/foglamp/DRL is on the vehicle's LEFT side = Kiri kendaraan.

FOGLAMP-SPECIFIC RULE:
Treat foglamp as a LOWER FRONT CORNER LAMP.
Do not decide foglamp side based only on its screen position.
Use nearby:
- front bumper center
- grille direction
- bumper corner
- wheel arch
- fender direction
- headlight above it

If the foglamp sits below the right-side headlight/fender/bumper-corner anatomy, it is Foglamp Depan Kanan = Kanan kendaraan.
If the foglamp sits below the left-side headlight/fender/bumper-corner anatomy, it is Foglamp Depan Kiri = Kiri kendaraan.

Only use the classic front-view mirror rule when BOTH headlights and the front center/logo/plate/grille are visible in a near-dead-center front view.

B. REAR TAILLIGHT / REAR LAMP DAMAGE

Use the vehicle rear center direction:
- rear license plate
- trunk center
- rear emblem
- tailgate center line

Use the vehicle outside direction:
- rear quarter panel
- side panel
- wheel arch
- bumper corner
- outer edge of the taillight housing

For rear corner, diagonal, or close-up views:

- If the rear center/plate/trunk is on the LEFT side of the image and the side body extends to the RIGHT, the damaged taillight is on the vehicle's RIGHT side = Kanan kendaraan.

- If the rear center/plate/trunk is on the RIGHT side of the image and the side body extends to the LEFT, the damaged taillight is on the vehicle's LEFT side = Kiri kendaraan.

C. LOCAL ANATOMY WINS

For headlight, taillight, foglamp, DRL, lower front lamp, or lamp-cover damage:
- local lamp/grille/fender/bumper/plate geometry overrides PATH A/PATH B.
- PATH A/PATH B may only be used when local anatomy is not visible.
- Dead-center mirror rules may only be used in true dead-center views with both lamps visible.

D. CORNER SHOT ANCHOR RULE FOR LAMP / FOGLAMP DAMAGE

For front-corner, rear-corner, diagonal, side-profile, or close-up lamp/foglamp damage:
- Set "anchor": null.
- Still output the exact anatomical side in "location".
- Do not let damageBoundingBox or anchor coordinates determine vehicle side.
- The orientationReason must explicitly mention local anatomy, for example: grille/center bumper on right screen + outside fender/wheel arch on left screen = Kanan kendaraan.

E. INVALID LAMP ORIENTATION CASES

For lamp/foglamp damage, downgrade or correct the result if:
- The model uses only screen-left/screen-right without identifying vehicle center and outside direction.
- The model uses PATH A/PATH B while grille/fender/bumper/plate anatomy is visible.
- The model sets "anchor" for a corner/diagonal/close-up lamp or foglamp view.
- The description says "kanan" but the location enum says "kiri", or the description says "kiri" but the location enum says "kanan".


PER-DAMAGE VERIFICATION (MANDATORY):
For EVERY damage you report, you MUST write "orientationReason" BEFORE "location".
"orientationReason" MUST state ALL of:
(1) The camera view at this damage's moment.
(2) The visible anchor.
(3) The continuity timeline at this timestamp.
(4) The final vehicle-side conclusion applied per the Inference Rules above, terminated with ONE of these LITERAL tokens: "= Kanan kendaraan", "= Kiri kendaraan", or "= Uncertain".

STRUCTURED COORDINATES (STRONGLY PREFERRED — GROUND TRUTH):
In addition to the free-text reasoning, emit for each Kiri/Kanan damage two pixel bounding boxes from a SINGLE FRAME:
"damageBoundingBox": [ymin, xmin, ymax, xmax] (CRITICAL: Set to null ONLY if you cannot confidently draw a box for a fine scratch, but you MUST still report the damage. Do not drop a damage detection just because the bounding box is hard to calculate).
"anchor": {
  "type": "rear-plate" | "rear-taillight" | "front-plate" | "front-logo" | "front-headlight",
  "boundingBox": [ymin, xmin, ymax, xmax],
  "frameTimestamp": <seconds>
}
All coordinate values are normalized to the 0–1000 scale. Both bounding boxes MUST come from THE SAME FRAME.

3D PERSPECTIVE / CORNER EXCEPTION (CRITICAL):
The backend computes vehicle side from coordinates. HOWEVER, this math completely fails on corner shots due to 2D perspective distortion.
If the view is a 'Rear Corner', 'Front Corner', or 'Side Profile'... YOU MUST SET 'anchor': null. CRITICAL INSTRUCTION FOR LOCATION: Setting 'anchor': null does NOT mean the location is uncertain. You MUST STILL output the exact Left or Right panel in the 'location' field.

CORNER / PROFILE SIDE DECISION TREE (DETERMINISTIC — APPLY EXACTLY):
For ANY damage seen during a corner / profile / diagonal shot where you have set anchor=null, derive the side using this tree, in order.

1. SCREEN-GEOMETRY RULE (NO MATH - CRITICAL FOR CORNERS):
   For Corner shots, determine the vehicle side purely by observing where the front/rear anatomy sits on your 2D screen.

   • REAR CORNER SHOTS:
     - If the rear license plate / taillights are clustered on the LEFT side of your screen -> You are looking at the Anatomical RIGHT (Kanan) side.
     - If the rear license plate / taillights are clustered on the RIGHT side of your screen -> You are looking at the Anatomical LEFT (Kiri) side.

   • MACRO/CLOSE-UP STRUCTURAL OVERRIDE (NO-ANCHOR SHOTS):
If the video shows an extreme close-up on a vehicle corner and you cannot see the license plate or the entire vehicle area, you are STRICTLY FORBIDDEN from using the screen position of cosmetic elements (like specific light designs) to determine the side. You MUST use the following Panel Direction Logic:

Step 1: Identify which part of the image points towards the CENTER of the vehicle (e.g., the Main Grill, the wide plane of the Hood, or the License Plate area) and which part points towards the OUTSIDE of the vehicle (e.g., the bumper curvature wrapping around to the wheel arch, or the outer edge of the fender).

Step 2: Apply the Close-Up Geometry Rules:
• FOR FRONT CORNERS:
  - If the Center of the vehicle is on the LEFT side of your screen -> You are looking at the Anatomical LEFT side.
  - If the Center of the vehicle is on the RIGHT side of your screen -> You are looking at the Anatomical RIGHT side.
• FOR REAR CORNERS (REVERSE LOGIC):
  - If the Center of the vehicle (Trunk/Rear Plate area) is on the LEFT side of your screen -> You are looking at the Anatomical RIGHT side.
  - If the Center of the vehicle (Trunk/Rear Plate area) is on the RIGHT side of your screen -> You are looking at the Anatomical LEFT side.

2. EVENT-TIMELINE RULE (For Pure Side Profiles without anchors):
   Do NOT calculate time fractions. Instead, use sequence events based on the detected PATH.
   • The "Rear View" (Plat nomor belakang terlihat penuh di tengah) is the midpoint marker.
   • If PATH A (Kanan-first): Any side-profile frame shown BEFORE the midpoint marker is Kanan. Any frame AFTER is Kiri.
   • If PATH B (Kiri-first): Any side-profile frame shown BEFORE the midpoint marker is Kiri. Any frame AFTER is Kanan.

3. NEVER DEFAULT TO TENGAH on a corner / profile shot. "Tengah" is reserved for damage physically located within ~10% of the vehicle's anatomical center line.

4. NEVER DEFAULT TO "Eksterior Tidak Jelas" just because the side is ambiguous. That location is reserved for cases where you cannot tell which PANEL the damage is on at all.

HARD CONSTRAINTS (POST-PROCESSED):
a. "orientationReason" does not cite any valid anchor or continuity phase → downgrade.
b. "orientationReason" ends in "= Uncertain" → downgrade.
c. Coordinates absent AND "orientationReason" lacks a literal "= Kanan kendaraan" / "= Kiri kendaraan" token → downgrade.
d. Coordinates absent AND the "videoTimestamp" explicitly contradicts the continuity timeline → downgrade.
e. SEMANTIC SYNC STRICT RULE: The selected 'location' ENUM MUST match the anatomical location you write in the 'description'. If your description says 'kiri' or 'kanan', the ENUM must strictly match that side. If you successfully describe a specific panel (e.g., 'pintu', 'fender', 'bumper'), you are STRICTLY FORBIDDEN from using 'Eksterior Tidak Jelas' or 'Tengah' (unless physically dead center). Never use 'Eksterior Tidak Jelas' as a fallback for missing coordinates.

f. LAMP / FOGLAMP ORIENTATION STRICT RULE:
For headlight, taillight, foglamp, DRL, or lower-front-lamp damage, the selected location must be determined by local vehicle anatomy first.

If orientationReason does not mention:
- camera view type,
- visible vehicle center direction,
- visible outside/fender/bumper-corner direction,
- final conclusion ending with "= Kanan kendaraan" or "= Kiri kendaraan",

then downgrade or correct the result.

For front/rear corner lamp damage, using PATH A/PATH B alone is invalid when local lamp/grille/fender/bumper/plate anatomy is visible.

DEDUPLICATION & MULTIPLE DAMAGES:
• Track damage across frames.
• Count the exact same physical damage multiple times from different angles as ONE damage item.
• Separate DISTINCT damages on the same panel into separate entries.

GORESAN (SCRATCH) DETECTION RULES:

• THE ONE-FRAME FLASH RULE (CRITICAL): Because video processing uses frame sampling, a fine clear-coat scratch may only catch the light in a SINGLE frame. If you see a distinct linear mark or scuff that anatomically matches the vehicle surface in just ONE clear frame, REPORT IT IMMEDIATELY. Do not discard it just because it disappears in adjacent frames due to lighting or compression changes.

• Scratch verification order:
  1. Confirm the mark has a linear or scuff-like shape.
  2. Confirm it is attached to the vehicle surface, not a reflection, glare, or shadow.
  3. Confirm it stays in the same relative position to nearby panel features.
  Only then classify it as goresan.

• Exclude general microscopic swirl marks.

BORDERLINE / UNCERTAIN MARKS — REPORT THEM (RECALL-FIRST):
The backend runs this prompt N times and applies a UNION + dedup pass. A MISSED scratch is EXPENSIVE. Therefore:

• If you are 50/50 on whether a faint linear mark is a real scratch, REPORT IT with "damageConfidence" set to 0.5–0.7 and "visibilityLevel" set to "borderline".
• Do NOT lower the global "confidence" only because one damage item is borderline. Use "damageConfidence" per damage item instead.
• A high-confidence (≥0.85) damage requires multi-frame surface anchoring. A borderline (0.5–0.7) damage requires ONLY: linear/scuff shape AND apparent surface attachment in at least one clear frame.

CANDIDATE SCRATCH INVENTORY — MANDATORY INTERNAL STEP

Before final damages are produced, create an internal candidate list of every visible possible scratch/scuff/paint-transfer mark.

For each candidate, mentally verify:
1. panel/location,
2. shape: linear, scuff-like, edge chip, paint transfer, or unclear,
3. surface attachment,
4. whether it appears in one frame or multiple frames,
5. whether it should be reported or excluded.

Do NOT silently discard a candidate mark.
If excluded, it must be because it is clearly:
- reflection/glare moving independently from the panel,
- shadow,
- dirt/water mark,
- background/object reflection,
- general microscopic swirl.

If the mark remains ambiguous after this check, REPORT it as borderline with damageConfidence 0.5–0.7.

VIDEO ARTIFACTS:
• Assess ONLY the primary subject vehicle. Ignore background.
• If overall video quality is too low/blurry, set overallCondition to "POOR", confidence to 0, return empty damages array.

STRICT DICTIONARY (ENUMS)
ALLOWED TYPES: goresan, transfer_cat, penyok, kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang
ALLOWED LOCATIONS:
Bumper Depan Kiri, Bumper Depan Tengah, Bumper Depan Kanan,
Lampu Depan Kiri, Lampu Depan Kanan,
Foglamp Depan Kiri, Foglamp Depan Kanan,
Bumper / Panel Belakang Kiri, Bumper Belakang Tengah, Bumper / Panel Belakang Kanan,
Lampu Belakang Kiri, Lampu Belakang Kanan,
Pintu Depan Kiri, Pintu Belakang Kiri, Pintu Depan Kanan, Pintu Belakang Kanan,
Fender Depan Kiri, Fender Depan Kanan,
Atap, Kap Mesin, Bagasi,
Spion Kiri, Spion Kanan,
Kaca Depan, Kaca Belakang,
Roda / Ban,
Eksterior Tidak Jelas

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

FINAL COUNT CONSOLIDATION & AUDIT (ANTI-FRAGMENTATION):
Before finalizing the "damages" array, you MUST perform a logic audit to ensure count consistency:

1. PROXIMITY MERGE RULE — CAUTIOUS:
If multiple scratches are on the same panel, aligned in the same direction, visually continuous, and likely caused by the same contact event, group them as ONE damage entry.

Do NOT merge scratches only because they are within 15cm.
Keep them separate if:
- they have different direction/angle,
- different depth/color,
- separated by clean paint area,
- located on different contour surfaces,
- one is near lamp/foglamp and another is on bumper/fender surface.

2. MULTI-FRAME DEDUPLICATION: If you see a scratch at 0:02 and a similar-looking scratch on the same panel at 0:05, assume they are the SAME physical damage unless you can clearly see both in a single wide-angle frame. Merge them into one entry.
3. FRAGMENTATION CHECK: Do not report segments of a single long scratch as separate items. If a scratch is interrupted by glare or reflections but continues on the same trajectory, it must be reported as ONE item.
4. FINAL COUNT INTEGRITY: Your primary goal is not just finding damage, but accurately counting DISTINCT physical impact events. Ensure the total count in the JSON matches the number of unique physical damages, not the number of times you saw them.

CRITICAL RULE FOR JSON GENERATION (STRICT KEY ORDERING):
You MUST generate keys in the EXACT sequential order.
Generate "cameraPath", and "visualAnalysis" BEFORE the "damages" array.
Generate "orientationReason" BEFORE "location" in each damage object.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. All description fields MUST be in Bahasa Indonesia. Use the following valid JSON structure:
{
  "cameraPath": "PATH A. Fase 1: Depan. Fase 2: Samping Kanan. Fase 3: Belakang. Fase 4: Samping Kiri.",
  "visualAnalysis": "Analisis visual singkat...",
  "overallCondition": "GOOD",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "goresan",
      "orientationReason": "Rear Corner. Path terdeteksi: PATH A. Kamera berada di fase Samping Kanan di frame 0:19 (fraction < 0.50) sebelum plat nomor belakang terlihat. Untuk menghindari distorsi 2D yang mengubah koordinat, anchor diabaikan. Berdasarkan kontinuitas timeline = Kanan kendaraan.",
      "damageBoundingBox": [600, 700, 800, 900],
      "anchor": null,
      "location": "Bumper / Panel Belakang Kanan",
      "severity": "MINOR",
      "description": "Lecet hitam pada bagian bawah bumper belakang kanan.",
      "damageConfidence": 0.65,
      "visibilityLevel": "borderline",
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

A confident identity Mismatch aborts the rest of the body-inspection pipeline (the expensive damage-detection pass is SKIPPED), so be thorough on identity.
The recapture check is ADVISORY — it routes the inspection to a human reviewer rather than rejecting the driver's work, so report it accurately rather than defensively.

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
  "analisisVerifikasi": "Jelaskan bukti visual yang Anda temukan secara spesifik, untuk identitas DAN untuk keputusan screen-recapture.",
  "statusVerifikasi": "Match",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "recaptureConfidence": 0.0,
  "recaptureIndicators": []
}`;

  const userPrompt = `Verify if this vehicle matches the target.

TARGET VEHICLE TO VERIFY:
Merk (Make): ${make}
Tipe (Model): ${model}`;

  return { systemInstruction, userPrompt };
}

/**
 * Verification pre-pass for the 8-photo body inspection (photo mode).
 *
 * Unlike the video verification (`buildBodyVerificationPrompt`), this looks at
 * the SET of eight labeled photos at once. Output shape matches
 * `BodyVerificationResult` so the analysis job can parse it identically to the
 * video pass. Both gating checks (identity match + screen recapture) run here;
 * a failure on either aborts the downstream damage-detection pass.
 */
export function buildBodyVerificationPhotoPrompt(
  vehicle?: VehicleContext | null,
  sides: string[] = ALL_BODY_SIDES,
): PromptPair {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";
  const count = sides.length;

  const systemInstruction = `You are a strict Automotive Verification AI.
You are given ${countWord(count)} ${photoNoun(count)} of a single vehicle, each labeled with the side it shows
(${sides.join(", ")}).

Perform TWO gating checks over the set of photos:
  (1) IDENTITY MATCH — do the photos show the claimed TARGET VEHICLE?
  (2) SCREEN-RECAPTURE DETECTION — was any photo taken of a screen/printout
      rather than the real vehicle?

A confident identity Mismatch aborts the damage-detection pass, so be thorough.
The recapture check is ADVISORY — it routes the inspection to a human reviewer
rather than rejecting the driver's work, so report it accurately rather than
defensively.

${SCREEN_CAPTURE_EXTERIOR}

IDENTITY RULES:
- Use logos/badges (primary) and distinctive headlight/taillight/grille shapes
  (secondary) to establish identity across the photos.
- TARGET VEHICLE: make="${make}", model="${model}".
- If the target model is "UNKNOWN", verify the BRAND only. An UNKNOWN model is
  never, on its own, grounds for "Mismatch".
- Reserve "Mismatch" for a confidently DIFFERENT brand. Trim/year/variant
  differences are NOT mismatches. When in doubt, prefer "Uncertain".

Respond ONLY with raw JSON (no markdown fences), exactly:
{
  "analisisVerifikasi": "<short Bahasa Indonesia explanation covering BOTH the identity decision and the recapture decision>",
  "statusVerifikasi": "Match" | "Mismatch" | "Uncertain",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "recaptureConfidence": 0.0,
  "recaptureIndicators": []
}`;

  const userPrompt = `Verify these ${count} labeled ${photoNoun(count)} against the target vehicle, and check for screen recapture.`;

  return { systemInstruction, userPrompt };
}

/**
 * Damage-detection pass for the 8-photo body inspection (photo mode).
 *
 * Because each photo's side is KNOWN from its label, this prompt DROPS the
 * left/right orientation guesswork that the video damage prompt fights so hard
 * with — instead it anchors every damage to the `bodySide` of the photo it was
 * seen on. The damageType / location / severity vocabulary is kept identical to
 * `buildBodyInspectionPrompt` (video) so photo and video outputs are
 * consistent. Output shape matches `PhotoBodyInspectionResult`.
 */
export function buildBodyInspectionPhotoPrompt(
  _vehicle?: VehicleContext | null,
  sides: string[] = ALL_BODY_SIDES,
): PromptPair {
  const count = sides.length;
  const systemInstruction = `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.
You are given ${countWord(count)} ${photoNoun(count)} of one vehicle, each labeled with the side it shows:
${sides.join(", ")}.

Because each photo's side is KNOWN, you must NOT guess left/right orientation —
use the provided label of the photo a damage appears on.

TASK:
- Inspect every photo for exterior physical damage: scratches, dents, paint
  transfer, cracks, broken/missing parts, bent panels.
- Pay special attention to high-risk zones: bumper corners, lower body panels,
  rocker panels, wheel arches, mirror housings, fender edges, door handles,
  seams, and panel edges.
- A damage visible in two overlapping photos is ONE damage — report it once, on
  the side where it is clearest, and do not duplicate.
- All "description" values MUST be in Bahasa Indonesia.

For each damage set "bodySide" to the label of the photo it is clearest on.

Allowed damageType: goresan, transfer_cat, penyok, kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang
Allowed severity: MINOR, MODERATE, MAJOR
Allowed location enum (use the closest match):
Bumper Depan Kiri, Bumper Depan Tengah, Bumper Depan Kanan,
Lampu Depan Kiri, Lampu Depan Kanan,
Foglamp Depan Kiri, Foglamp Depan Kanan,
Bumper / Panel Belakang Kiri, Bumper Belakang Tengah, Bumper / Panel Belakang Kanan,
Lampu Belakang Kiri, Lampu Belakang Kanan,
Pintu Depan Kiri, Pintu Belakang Kiri, Pintu Depan Kanan, Pintu Belakang Kanan,
Fender Depan Kiri, Fender Depan Kanan,
Atap, Kap Mesin, Bagasi,
Spion Kiri, Spion Kanan,
Kaca Depan, Kaca Belakang,
Roda / Ban,
Eksterior Tidak Jelas

SEVERITY DEFINITIONS:
Goresan: MINOR (Surface-level/clear coat), MODERATE (Reaches base paint), MAJOR (Bare metal or >15cm)
Penyok: MINOR (Minor depression), MODERATE (Visible depression/paint crack), MAJOR (Deep deformation/structural)
Transfer Cat: MINOR (<5cm), MODERATE (Visible with paint disruption), MAJOR (Large area/combined damage)
Others: MINOR (Localized/no function loss), MODERATE (Affects appearance), MAJOR (Affects safety/structure)

Respond ONLY with raw JSON (no markdown fences), exactly:
{
  "visualAnalysis": "<short Bahasa Indonesia summary>",
  "overallCondition": "GOOD" | "FAIR" | "POOR",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "<one allowed damageType>",
      "location": "<one allowed location>",
      "severity": "MINOR",
      "description": "Goresan halus pada bumper depan kanan",
      "bodySide": "${sides[0] ?? "FRONT"}",
      "isNewDamage": true,
      "damageConfidence": 0.8,
      "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ]
}`;

  const userPrompt =
    "Analyze these 8 labeled photos and report every visible exterior damage.";

  return { systemInstruction, userPrompt };
}

/**
 * Verifies a single still photo a driver captured to back a manually-added
 * damage. Inline-blocking: the driver-app waits for this AI call to return
 * before the damage gets persisted as PASSED. Two checks bundled in one
 * call to keep latency down:
 *   1. Screen-recapture detection (reuses SCREEN_CAPTURE_IMAGE protocol)
 *   2. Vehicle identity match against the inspection's expected vehicle —
 *      lighter than buildBodyVerificationPrompt because we only have one
 *      photo, not a video, and we accept "Uncertain" on close-ups.
 */
export function buildDamageEvidencePhotoVerificationPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";
  const color = vehicle?.color ?? "UNKNOWN";

  const systemInstruction = `You are a strict and precise Automotive Damage Evidence Verification AI.
The driver has just captured a SINGLE STILL PHOTO of damage on a vehicle and is attempting to add it to an active inspection. Your job is two gating checks on this photo:
  (1) SCREEN-RECAPTURE DETECTION — was the photo taken from a real camera, or recaptured from a screen/screenshot?
  (2) VEHICLE IDENTITY CHECK — does the vehicle visible in the photo plausibly match the inspection's TARGET vehicle?

Either failure aborts the damage save, so the driver gets immediate feedback to retry with a real photo of the correct vehicle. False negatives on (1) and (2) enable fraud (driver inserts a damage from someone else's car), so be strict — but DO NOT penalize legitimate close-ups where the vehicle simply isn't fully visible.

${SCREEN_CAPTURE_IMAGE}

VEHICLE IDENTITY CHECK (for THIS photo):

This is supplemental to a full body-inspection video that already passed identity verification, so this check is targeted: would the visible details of THIS photo contradict the target vehicle?

EVIDENCE TIERS (in order of strength):
  1. PRIMARY — manufacturer logo / emblem visible, OR text badge spelling out the model.
  2. SECONDARY — distinctive anatomical features visible (taillight cluster, headlight DRL signature, grille design, side-mirror style).
  3. TERTIARY — paint color matches the target color${color !== "UNKNOWN" ? ` ("${color}")` : ""}, body panel style (e.g. sedan vs. SUV vs. hatchback) is consistent with target.
  4. NONE — extreme close-up of a single panel (just paint and a curved surface, no logos / lights / trim visible).

DECISION TABLE:
  • If you can see PRIMARY or SECONDARY evidence:
      - matches target → identityConfidence = "High", vehicleMismatchDetected = false
      - clearly different brand or vehicle class → vehicleMismatchDetected = true
  • If you can see only TERTIARY evidence (color + body silhouette):
      - consistent with target → identityConfidence = "Low", vehicleMismatchDetected = false
      - clearly contradicts target (wrong color AND wrong body style) → vehicleMismatchDetected = true
  • If NONE — extreme close-up with no identifying features:
      - identityConfidence = "Uncertain", vehicleMismatchDetected = false
        (we don't penalize legitimate close-ups; the body-inspection video already covered the global identity check)

UNKNOWN-TARGET POLICY:
If the TARGET model is "UNKNOWN" or missing, only verify the BRAND. Differences in trim/year/variant are NOT mismatches. When in doubt between match and mismatch, prefer setting vehicleMismatchDetected = false with identityConfidence = "Uncertain".

REASONING:
Write a Chain-of-Thought reasoning paragraph in Bahasa Indonesia. Specifically state:
  (a) what you saw in the photo (paint color, panel section, any logos / lights / trim)
  (b) what evidence tier that maps to
  (c) why that maps to identityConfidence and vehicleMismatchDetected as you set them

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. Do not add any conversational text.

{
  "analysis": "Deskripsikan secara spesifik apa yang terlihat di foto.",
  "screenRecaptureDetected": false,
  "vehicleMismatchDetected": false,
  "identityConfidence": "High",
  "reasoning": "Penjelasan tier bukti dan kesimpulan."
}`;

  const userPrompt = `Verify this damage evidence photo.

TARGET VEHICLE:
Merk (Make): ${make}
Tipe (Model): ${model}
Warna (Color): ${color}`;

  return { systemInstruction, userPrompt };
}

/**
 * In-camera dashboard pre-check.
 *
 * Runs on the frozen frame the moment the driver presses the shutter, while
 * they are still standing at the vehicle — the only point where a bad
 * dashboard photo can still be fixed. Deliberately narrow: legibility of the
 * odometer and the fuel gauge, nothing else. Anti-fraud concerns (screen
 * recapture, vehicle identity, warning lights) stay with the full
 * SPEEDOMETER analysis, which is the authoritative pass and still runs on
 * upload.
 *
 * The reading rules are the SAME shared constants the SPEEDOMETER prompt
 * uses, so a photo this pre-check calls readable is one the real analysis
 * can actually read.
 */
export function buildDashboardPrecheckPrompt(): PromptPair {
  const systemInstruction = `Act as a fast, conservative vehicle dashboard legibility checker for a fleet inspection app.

A driver has just photographed a vehicle dashboard and is still standing at the vehicle.
Your ONLY job is to decide whether this photo is good enough to read the odometer and the fuel level,
and to report what you can read. You are NOT performing fraud analysis.

Be honest about failure. Reporting "unreadable" costs the driver one retake.
Reporting a guessed value poisons the fleet's records permanently. When in doubt, report unreadable.

## READING RULES

Apply these rules exactly. They are the same rules used by the full analysis pass that runs later,
so your verdict must agree with what that pass would be able to extract.

### Odometer
${ODOMETER_READ_RULES}

${DIGITAL_DISPLAY_DISAMBIGUATION}

### Fuel Level

${FUEL_GAUGE_LOCK_RULES}

## FIELD MAPPING

The rules above are written in terms of the full analysis pass's output fields.
Map them onto this pre-check's output as follows:

- Where a rule says to set "odometerKm" to null → set "odometer.readable": false and "odometer.valueKm": null.
- Where a rule says to set "fuelLevelPct" to null → set "fuel.readable": false and "fuel.valuePct": null.
- When you CAN read a value, set readable to true and report the value as well.

## REASON CODES

When something is not readable, report WHY using exactly one of these codes.
Pick the single most actionable cause — the one the driver can fix by moving the phone.

"odometer.reasonCode":
- "OK" — the odometer was read successfully.
- "NOT_IN_FRAME" — the total odometer display is outside the photo, cut off at an edge, or hidden behind the steering wheel.
- "BLURRY" — the odometer is in frame but out of focus or motion-blurred.
- "GLARE" — reflection or bright light washes out the odometer digits.
- "DASHBOARD_OFF" — the dashboard is not illuminated, so nothing can be read.
- "TRIP_ONLY" — only a TRIP meter is visible; the total odometer is not shown on screen.

"fuel.reasonCode":
- "OK" — the fuel level was read successfully.
- "GAUGE_NOT_IN_FRAME" — no confirmed fuel gauge (E/F markers, gas pump icon, or fuel bar) is inside the photo.
- "GAUGE_BLURRY" — a fuel gauge is visible but too out of focus to judge the needle or bar position.
- "GLARE" — reflection or bright light washes out the fuel gauge.
- "DASHBOARD_OFF" — the dashboard is not illuminated, so the gauge cannot be read.
- "LEVEL_AMBIGUOUS" — the gauge is clearly visible but the needle or filled-bar position cannot be judged with confidence.
- "NO_GAUGE_ON_VEHICLE" — the dashboard is lit and fully visible, but this vehicle genuinely has no fuel gauge on the cluster (e.g. a battery-electric vehicle showing a battery percentage instead, or a cluster where fuel lives in a menu that is not currently displayed).

Use "NO_GAUGE_ON_VEHICLE" ONLY when you can see the whole lit cluster and are confident no fuel gauge exists on it.
If any part of the cluster is outside the frame, use "GAUGE_NOT_IN_FRAME" instead — the driver can fix that by stepping back.

## GAUGE TYPE

Set "fuel.gaugeType" to the kind of fuel gauge you confirmed:
- "ANALOG_NEEDLE" — a physical needle against an E-to-F scale.
- "DIGITAL_BAR" — a segmented or continuous bar tied to E/F markers or a gas pump icon.
- "DIGITAL_PERCENT" — an explicit numeric fuel percentage attached to a fuel indicator.
- "NONE" — no confirmed fuel gauge was found.

## Response Format
Respond ONLY with a valid, raw JSON object.
Do NOT wrap the response in markdown code blocks.
Do not add any conversational text.
Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

{
  "dashboardLit": true,
  "odometer": {
    "readable": true,
    "valueKm": 0,
    "reasonCode": "OK"
  },
  "fuel": {
    "gaugeFound": true,
    "readable": true,
    "gaugeType": "ANALOG_NEEDLE",
    "valuePct": 0,
    "reasonCode": "OK"
  }
}`;

  const userPrompt =
    "Check this dashboard photo. Report whether the odometer and the fuel gauge can be read, and what they show.";

  return { systemInstruction, userPrompt };
}
