# System Architecture

> Purpose: Define the complete technical architecture of the on-device Focus Intelligence System, including sensing layers, feature extraction logic, scoring fusion, personalization, storage policies, and runtime constraints.

> Design Principles:
- On-device only (no cloud processing)
- Privacy-by-design
- Explainable scoring
- Modular 3-layer sensing
- Adaptive personalization
- Performance-aware execution

---

# 1. Architectural Overview

The system consists of five major layers:

1) Data Capture Layer  
2) Feature Extraction Layer  
3) Multi-Layer Intelligence (3-Layer Model)  
4) Scoring & Explainability Engine  
5) Personalization & Optimization Layer  

All components operate locally.

---

# 2. Data Capture Layer (Foundation)

## 2.1 Active Window Tracking
- Uses OS-level APIs (active-win)
- Captures:
  - app_name
  - window_title (sanitized, no OCR)
- No keystroke content is stored

## 2.2 Global Input Telemetry
- Powered by native OS hooking (uiohook-napi)
- Captures aggregated metrics only:
  - Keystroke counts
  - Inter-key timing intervals
  - Mouse movement vectors
  - Scroll deltas
- No raw key values persisted

## 2.3 Smart Save Logic
Persistence triggered only when:
- Window changes
- Input > 0
- Optional low-frequency heartbeat

Schema:
- timestamp
- app_name
- window_title
- input_metrics
- session_id

Performance Target:
- <1% background CPU during idle monitoring

---

# 3. Semantic Context Layer (EPIC-01)

## Goal
Determine whether the user's current digital activity aligns with their declared Deep Work Goal.

## 3.1 Model Stack
- Sentence-BERT (local weights: .onnx or equivalent)
- Transformers.js integration
- On-device embedding generation

## 3.2 Semantic Matching
- Cosine Similarity between:
  - Goal embedding
  - Window title embedding
- Threshold-based classification:
  - Work
  - Distraction

## 3.3 Context Switching Logic
- Dwell time tracking
- Frequency of app switches
- Context-switch penalty calculation

Risks:
- Embedding latency
- Ambiguous window titles

---

# 4. Behavioral Dynamics Layer (EPIC-02)

## Goal
Detect behavioral fingerprints of focused vs distracted states.

## 4.1 Typing Rhythm Analyzer
- WPM calculation
- Standard deviation of inter-key intervals
- Stability score

## 4.2 Mouse Kinematics
- Linear regression for path straightness
- Jitter measurement
- Velocity patterns

## 4.3 Scroll Pattern Analysis
- Scroll frequency
- Scroll velocity
- Reading vs skimming classification

## 4.4 Behavioral Anomaly Detection
- Clustering or SVM-based baseline modeling
- Personalized focus fingerprint

Risks:
- High variance across task types
- False positives during gaming or non-work tasks

---

# 5. Visual Attention Layer (EPIC-03)

## Goal
Provide physical attention confirmation, especially for passive focus tasks.

## 5.1 Vision Stack
- MediaPipe Face Mesh
- On-device gaze estimation
- On-screen vs off-screen probability

## 5.2 Derived Signals
- Gaze stay-time
- Off-screen duration
- Attention present flag

## 5.3 Passive Focus Defense
"Reading Mode" detection when:
- Scroll velocity steady
- Gaze stable
- Low keystroke input

Privacy Constraint:
- No raw video storage
- Only derived coordinates retained in volatile memory

Risks:
- Low light conditions
- Battery consumption

---

# 6. Scoring & Fusion Engine (EPIC-04)

## 6.1 Weighted Model (Initial Version)
Focus Score (0–100) composed of:
- 40% Semantic Context
- 40% Behavioral Dynamics
- 20% Visual Attention

Weights adjustable via calibration layer.

## 6.2 Context Penalties
- High context switch frequency reduces score
- Off-screen gaze reduces score
- Stable rhythm increases score

## 6.3 Score Attribution Engine
Breakdown example:
- +25 Stable typing rhythm
- -15 Frequent app switching
- -10 Off-screen gaze
- +20 High semantic alignment

Provides:
- Human-readable explanations
- “Why this score?” UI panel

## 6.4 Focus Leak Report
- Identifies top 3 distraction apps
- Reports context-switch frequency
- Shows dwell-time heatmap

---

# 7. Personalization & Calibration Layer (EPIC-05)

## 7.1 Baseline Mode
- 2–3 day calibration period
- Collects behavioral distribution statistics
- Establishes per-user thresholds

## 7.2 Normalization
- Adjust typing stability thresholds
- Adjust gaze tolerance window
- Adjust semantic threshold sensitivity

## 7.3 Drift Detection
- Detect long-term shifts in rhythm patterns
- Trigger recalibration recommendation

## 7.4 Adaptive Weight Tuning
- Adjust sensitivity without altering core model
- Prevent overfitting to short-term patterns

Risks:
- Over-calibration
- User confusion during recalibration

---

# 8. Dashboard & Reporting

## Local Web UI
- Express-based backend
- Chart.js visualization
- Daily/weekly focus trend graphs

## UI Modules
- Focus Score panel
- Attribution panel
- Focus Leak report
- Calibration state indicator
- Camera kill switch

---

# 9. Storage Strategy

Allowed to Persist:
- Aggregated metrics
- Derived features
- Focus scores
- Calibration parameters

Forbidden:
- Raw keystrokes
- OCR text
- Raw video frames
- Screen recordings

Recommended Storage:
- SQLite (scalable queries)
  or
- JSONL for early prototype

---

# 10. Cross-Platform & Build

- Electron-Builder for packaging
- Native module rebuild per OS architecture
- Handle macOS:
  - Accessibility permission
  - Screen recording permission
  - Camera permission

---

# 11. Failure Handling

- Permission denied → degrade gracefully
- Model load failure → fallback to heuristic classification
- CPU spike → reduce sampling rate
- Vision disabled → redistribute weight to semantic/dynamics

---

# 12. Open Technical Decisions

- ONNX vs lightweight JS embedding model?
- SQLite vs JSONL?
- Electron vs background daemon?
- Sampling strategy tuning?
- Model quantization for memory reduction?

