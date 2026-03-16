Role: You are an expert Full-Stack Engineer and AI Integrator.
Objective: Develop a vehicle inspection platform called Carreel AI that automates damage detection and form filling using AI.
Project Overview

The platform consists of:

    Driver App (Web/Mobile): Photo/Video recording with on-device/cloud AI for form automation and damage detection.

    Planner Dashboard: A verification interface for operations teams. 

    Audit Engine: Logged media and metadata storage.

Core Workflows to Implement:
1. Unit Identification (Photo)

    Action: Driver takes a photo of the vehicle.

    Logic: AI recognizes the model (make, type, color, license plate) and auto-populates the identification form.

    Output: Populated form with a confidence score; media linked to the unit record.

2. Speedometer Validation (Photo)

    Action: Driver captures the dashboard/speedometer.

    Logic: AI verifies if the dashboard layout matches the identified unit. It extracts KM (odometer) via OCR and fuel levels visually.

    Validation: Cross-check KM readings against historical data for "reasonableness."

    Output: Match/Mismatch status and structured telemetry data.

3. Body Inspection (Video - Pre & Post Trip)

    Action: Driver records a 360° walkaround video before and after the trip.

    Logic: AI analyzes frames to detect scratches, dents, or new damage by comparing pre-trip vs. post-trip footage.

    Output: Damage list (type: scratch/dent) with timestamped video bookmarks.

4. Planner Operations (Dashboard)

    Action: Planner reviews AI findings after a trip is completed.

    Features: Side-by-side comparison (Pre vs. Post), metadata viewing (KM, Geotag), and "Approve/Reject" workflow.

    Alerts: Notify planners if AI detects significant damage or low fuel.


Technical & UX Requirements:

    Metadata: Every media file must include a timestamp and GPS geotag.

    Role-Based Access: Specific edit/revert permissions for Drivers vs. Reviewers.

    Internal Tooling: A "Single Pane of Glass" for the operations team to assess risk and decide on dispatching inspection teams.