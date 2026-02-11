# Project Roadmap

> **Purpose:** This roadmap describes the high-level direction of the project (6–12+ months), including epics, milestones, major dependencies, and key risks.  
> **Non-goals:** This document does **not** track sprint tasks or implementation details (those live in `SCOPE.md` / sprint docs).  
> **Source of truth:** High-level plan only. Final decisions are recorded in `DECISIONS.md`.

---

## 1) Vision & Outcomes

### Vision
- An intelligent on-device system that decodes human intent and focus levels by analyzing "What" is being done (NLP), "How" it is being done (Dynamics), and "Where" the attention is (Vision).

### Target Outcomes (measurable)
- 90% Scoring Accuracy: High correlation between AI-calculated focus scores and subjective user deep-work states.
- Zero Latency & Privacy: All 3-layer sensing (including Vision/NLP) must run locally with <1% CPU overhead and zero data transmission.
- Context-Aware Defense: Reliable detection of "Passive Focus" (reading/watching) to prevent false-negative distraction alerts.

---

## 2) Roadmap Format

**Roadmap style:** ☐ Milestone-based

**Planning horizon:** (e.g., 2 quarters / 6 months / 12 months)  

**Review cadence:** (e.g., weekly light review + monthly deep review)

---

## 3) Epics (High-Level Workstreams)

> Epics are large workstreams that typically span multiple milestones/sprints.

### EPIC-01 — Semantic Context (NLP)
- **Goal:** To achieve a semantic match between the user's stated "Deep Work Goal" and their real-time digital activities (apps/titles) with >90% accuracy.
- **Scope:** In: S-BERT based vector similarity, Window Title 정밀 분석, App categorization logic.
            Out: Actual keystroke content logging (Privacy restriction), Cloud-based NLP (Must be local).
- **Key Deliverables:** Local Transformers.js integration for vector embeddings.
                        Semantic Goal-App Matching engine (Cosine Similarity).
                        Context Switching Frequency & Dwell Time tracker.
- **Primary Dependencies:** EPIC-01 (M-01 Foundation), Local NLP model weight files.
- **Major Risks:** Computational overhead of real-time embedding; ambiguity in window titles.
- **Owner:** NLP & Data Engineer

### EPIC-02 — Behavioral Dynamics Layer (Fingerprinting)
- **Goal:** To identify the "Fingerprint" of a user's flow state by analyzing the rhythm and kinematics of their input devices, independent of the app being used.
- **Scope:** In: Typing rhythm (WPM/Stability), Mouse kinematics (Linearity/Jitter), Scrolling patterns (Reading vs. Skimming).
            Out: Eye-tracking data (Handled in EPIC-03).
- **Key Deliverables:** Input Rhythm Analyzer (Standard deviation of inter-key intervals).
                        Mouse Movement Linear Regression model.
                        Anomaly Detection engine (Clustering/SVM) for personalized focus baselines.
- **Primary Dependencies:** EPIC-01 (Stable event hooking).
- **Major Risks:** High variance in user behavior across different tasks (e.g., gaming vs. coding).
- **Owner:** ML / Behavioral Scientist.

### EPIC-03 — Visual Attention Layer (Vision AI)
- **Goal:** To provide a physical "Ground Truth" for attention by confirming the user's gaze is directed at the screen, especially during passive tasks.
- **Scope:** In: Web-cam based gaze tracking (MediaPipe), On/Off-screen detection, Face Mesh landmarks.
            Out: Video storage (Privacy: Coordinates only), Multi-user identification. 
- **Key Deliverables:** MediaPipe Gaze Tracking module (On-device).
                        Visual Attention Score (Gaze Score 20%).
                        Edge Case Defense: "Reading Mode" confirmation via Gaze + Scroll synergy.
- **Primary Dependencies:** System camera permissions, EPIC-01/02 for task context.
- **Major Risks:** Low-light environments; CPU/Battery drain from continuous camera usage.
- **Owner:** Computer Vision Engineer.

### EPIC-04 — Intelligence & Reporting (Scoring Engine)
- **Goal:** To synthesize the 3-Layer data into a unified, actionable Focus Score (0-100) and provide a local dashboard for user feedback.
- **Scope:** In: Weighted scoring algorithm, Local data visualization, Historical trend analysis.
            Out: External data synchronization (Local-only remains priority).
- **Key Deliverables:** Final Scoring Model (40% Semantic + 40% Behavior + 20% Gaze).
                        Express-based Local Web Dashboard (Chart.js).
                        Personalized "Deep Work Report" generator.
- **Primary Dependencies:** Successful data outputs from EPIC-01, 02, and 03.
- **Major Risks:** Logic complexity leading to "Scoring Fatigue" (user not trusting the score).
- **Owner:** Full-stack Developer / Product Owner.

### EPIC-05 — Personalization & Calibration (User-Specific Intelligence)
- **Goal:** To adapt the global scoring model to each user’s unique behavioral patterns, ensuring the Focus Score reflects individual work styles and increases long-term trust in the system.
- **Scope:** In: Initial baseline data collection phase, per-user normalization parameters, behavioral drift detection, adaptive weighting adjustments.
            Out: Cross-user behavioral comparison, cloud-based profile learning (all personalization remains local).
- **Key Deliverables:** Initial 2–3 day Baseline Mode to learn user-specific input and attention patterns.
                        Personalized normalization layer adjusting thresholds for typing rhythm, mouse dynamics, and gaze stability.
                        Drift Detection engine identifying long-term behavioral shifts (fatigue, schedule change, task-type change).
                        Adaptive Scoring Tuner modifying weight sensitivity without changing the core model structure.
- **Primary Dependencies:** Stable scoring outputs from EPIC-04.
                            Reliable behavioral signals from EPIC-02 and EPIC-03.
- **Major Risks:** Overfitting to short-term behavior patterns.
                    User confusion during the calibration phase if scores fluctuate significantly.
- **Owner:** ML Engineer / Product Intelligence Lead.

---

## 4) Milestones

> Milestones are measurable checkpoints. Each milestone should have a clear "Definition of Done".

### M-01 — Foundation & Smart Save (Months 1-2)
- **Objective:** Establish a high-fidelity, non-invasive data logging infrastructure with zero data loss and stable OS hooking.
- **Definition of Done (DoD):**
  - [ ] Race-condition-free index.js with atomic counter reset implemented.
  - [ ] Conditional persistence logic (Save only on Window change OR Input > 0).
  - [ ] Schema support for app_name, window_title, and input_metrics.
  - [ ] Background process CPU usage stabilized under 1%.
- **Target Window:** Month 1
- **Related Epics:** EPIC-01
- **Dependencies:** uiohook-napi, active-win stability.
- **Risks:** OS-level security blocks for global input monitoring.

### M-02 — AI Core v1: Semantic Intent Matching
- **Objective:** Implement the first AI layer to determine "What" the user is doing by comparing current activity against stated goals.
- **DoD:**
  - [ ] Transformers.js integration for on-device vector embedding.
  - [ ] Semantic matching engine calculating Cosine Similarity between Goals and Window Titles.
  - [ ] Automatic classification of "Work" vs. "Distraction" based on similarity thresholds.
  - [ ] Context switching penalty logic based on Dwell_time.
- **Target Window:** Month 2
- **Related Epics:** EPIC-01
- **Dependencies:** M-01 (Stable logs), Local NLP model weights.
- **Risks:** High memory consumption of the NLP model on low-spec machines.

### M-03 — AI Core v2: Behavioral & Visual Defense
- **Objective:** Implement the "How" and "Where" layers—analyzing input rhythm and eye-gaze to detect deep focus and passive work.
- **DoD:**
  - [ ] MediaPipe Gaze Tracking module identifying On-Screen vs. Off-Screen status.
  - [ ] Typing rhythm analyzer (WPM Stability) and Mouse Kinematics engine.
  - [ ] "Reading Mode" detection via synergy of Scroll Speed and Gaze stay-time.
  - [ ] Anomaly detection for personalized behavioral fingerprints.
- **Target Window:** Month 3
- **Related Epics:** EPIC-02, EPIC-03
- **Dependencies:** System camera permissions, M-01 Hooking.
- **Risks:** Variable lighting affecting Gaze Tracking; high variance in mouse movement patterns.

### M-04 — Unified Intelligence & Local Insights
- **Objective:** Synthesize all layers into a final Focus Score and provide a user-facing visualization dashboard.
- **DoD:**
  - [ ] Weighted Scoring Model (40/40/20) calibrated and tested.
  - [ ] Local Express-based Web UI displaying daily/weekly focus trends.
  - [ ] "Focus Leak" report identifying the top 3 apps causing context switches.
  - [ ] Privacy Audit: Confirming all raw video/text data is purged from RAM.
- **Target Window:** Month 4
- **Related Epics:** EPIC-04
- **Dependencies:** Successful outputs from M-02 and M-03.
- **Risks:** Data complexity making the dashboard UI difficult for non-technical users.

### M-05 — Optimization, Explainability & Personalization
- **Objective:** Improve system efficiency, introduce score transparency, and adapt the scoring engine to individual user behavior for long-term trust and performance.
- **DoD:**
  - [ ] Score Attribution Engine implemented, breaking down the Focus Score into contributing factors (e.g., Context Switches, Gaze Off-Screen, Stable Input Rhythm).
  - [ ] Explainability panel added to the dashboard, showing "Why this score?" insights in real time.
  - [ ] Personal Baseline Mode completed (2–3 day calibration period).
  - [ ] Per-user normalization layer applied to behavioral and gaze thresholds.
  - [ ] Drift Detection logic identifying long-term changes in user patterns.
  - [ ] CPU usage optimization pass completed (average <3% during active sensing).
  - [ ] Memory footprint reduced for NLP + Vision modules.
- **Target Window:** Month 5
- **Related Epics:** EPIC-04, EPIC-05
- **Dependencies:** Stable Focus Score output from M-04.
                    Historical data accumulation for baseline calibration.
- **Risks:** Over-calibration reducing generalization across task types.
            User confusion if explanation data becomes too technical.
            Optimization efforts affecting detection accuracy.

---

## 5) Dependencies (Major)

> These are the critical external and technical blocks that must be resolved to hit milestones.

- DEP-01: Native OS Hooking (uiohook-napi) - Impact: EPIC-01, M-01 (Foundation) - Status: Resolved (Successfully integrated into the Node.js environment)
- DEP-02: DEP-02: OS Accessibility & Camera Permissions - Impact: EPIC-03, M-03 (Visual Sensing) - Status: Open (Requires handling macOS/Windows "Screen Recording" and "Camera" permission prompts)
- DEP-03: Local NLP Model Weights (Sentence-BERT) - Impact: EPIC-01, M-02 (Semantic Matching) - Status: Unknown (Need to verify the load time and memory footprint of .onnx or .bin weights in Electron)
- DEP-04: Cross-Platform Build Pipeline (Electron-Builder) - Impact: EPIC-04, M-04 (Final Launch) - Status: Open (Native modules require specific rebuild steps for different OS architectures).

---

## 6) Risks & Mitigations (Major)

> Keep this list short and high-signal. Detailed risks can live in sprint docs, but major systemic risks must be here.

- RISK-01: Privacy Resistance & Surveillance Perception
  - Impact: User adoption and trust.
  - Likelihood: High
  - Mitigation: Implement "Privacy-by-Design." All OCR and Gaze data must remain in volatile RAM and never be written to disk. Provide a "Kill Switch" for the camera in the UI.
  - Trigger: QA finding any raw sensitive data in the persistent focus_logs.json.

- RISK-02: Battery & Resource Exhaustion (Battery Drain)
  - Impact: UX (Users will uninstall if the laptop gets hot/slow)
  - Likelihood: Medium
  - Mitigation: Use "Trigger-based Sensing." Only activate Gaze Tracking and NLP analysis if the user is in a "Work-related" app. Optimize polling frequency.
  - Trigger: CPU usage exceeding 5% on average over a 10-minute period.

- RISK-03: The "Passive Work" False Negative - Impact: Scoring accuracy (Scoring 0 while the user is actually reading).
  - Impact: UX (Users will uninstall if the laptop gets hot/slow)
  - Likelihood: Medium
  - Mitigation: Heavy reliance on EPIC-03 (Gaze). If eyes are on the screen and scrolling is steady, the "Focus Score" stays high despite zero keystrokes.
  - Trigger: Subjective user feedback stating "I was focused but the app said I wasn't."

---

## 7) Roadmap → Scope Handoff Rule

> `SCOPE.md` must always map to a subset of this roadmap.

For any sprint / active scope:
- `SCOPE.md` must reference:
  - the milestone(s) it is driving toward, and/or
  - the epic(s) it supports

Format (recommended):
- **Active Scope:** SCOPE-2026-02-10 (Phase 1: Foundation Refinement)
- **Driven Milestone(s):** M-01 (Reliable Event Capture)
- **Related Epic(s):** EPIC-01 (Semantic Context Layer)

---

## 8) Change Log

> Record major roadmap changes only (priority shifts, milestone redefinitions, epic splits/merges).

- 2026-02-10 — Initial Roadmap Design — Reason: Project Kickoff and Phase 1 architecture alignment — Related Decision: D-001 (Adoption of 3-Layer Sensing Model)
- 2026-02-03 — Conceptual Draft — Reason: Preliminary research on NLP/Vision integration feasibility.

