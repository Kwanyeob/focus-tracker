# Project Roadmap

> Purpose: Define both the long-term strategic direction and the structured execution plan of the on-device Focus Intelligence System.
>
> Architecture details live in `ARCHITECTURE.md`.
> Active execution contracts live in `SCOPE.md`.
> Strategic pivots are recorded in `DECISION.md`.

---

# Part A - Strategic Direction (Executive Layer)

---

## 1. Vision

Build a privacy-first, fully on-device intelligence system that measures and explains human focus by combining:

- Semantic Intent (What)
- Behavioral Dynamics (How)
- Visual Attention (Where)

into a unified and trustworthy Focus Score.

---

## 2. Strategic Outcomes

- Target alignment between Focus Score and user-reported deep-work state
- Fully local execution (no raw sensitive data persistence)
- Passive focus detection (reading/watching) without false negatives
- Transparent and explainable scoring
- Long-term user trust through personalization

---

## 3. Strategic Epics

### EPIC-01 - Semantic Context Intelligence  
Determine whether user activity aligns with declared deep-work goals.

### EPIC-02 - Behavioral Dynamics Intelligence  
Model user-specific input patterns to identify focused vs distracted states.

### EPIC-03 - Visual Attention Intelligence  
Validate physical attention presence during active and passive work.

### EPIC-04 - Unified Scoring & Reporting  
Fuse multi-layer signals into a single actionable Focus Score.

### EPIC-05 - Personalization & Calibration  
Adapt scoring logic to individual baselines and long-term behavioral drift.

---

## 4. Milestone Roadmap (High-Level)

- M-01 - Foundation & Reliable Capture  
- M-02 - Semantic Intelligence v1  
- M-03 - Multi-Layer Defense  
- M-04 - Unified Intelligence & Dashboard  
- M-05 - Optimization & Personalization  

---

# Part B - Detailed Execution Plan (Operational Layer)

> This section may evolve without changing strategic direction.

---

## EPIC-01 - Semantic Context (Detailed)

**Goal:** Achieve semantic alignment between declared goals and real-time activity.

**Scope:**  
In: S-BERT vector similarity, window title analysis, app categorization logic  
Out: Keystroke content logging, cloud NLP

**Key Deliverables:**
- Local embedding generation
- Goal-Activity similarity engine
- Context switching tracker

**Major Risks:**
- Embedding latency
- Window title ambiguity

---

## EPIC-02 - Behavioral Dynamics (Detailed)

**Goal:** Identify behavioral fingerprints of focused states.

**Scope:**  
In: Typing rhythm, mouse kinematics, scroll behavior  
Out: Eye tracking (handled separately)

**Key Deliverables:**
- Rhythm stability metrics
- Mouse linearity detection
- Anomaly detection baseline

---

## EPIC-03 - Visual Attention (Detailed)

**Goal:** Confirm attention presence during passive tasks.

**Scope:**  
In: Gaze estimation, on/off screen detection  
Out: Video storage

**Key Deliverables:**
- On-device gaze tracking
- Passive reading detection logic

---

## EPIC-04 - Scoring Engine (Detailed)

**Goal:** Produce unified Focus Score and user insights.

**Key Deliverables:**
- Weighted scoring model
- Focus leak report
- Local dashboard

---

## EPIC-05 - Personalization (Detailed)

**Goal:** Adapt scoring to user-specific behavior.

**Key Deliverables:**
- Baseline mode
- Threshold normalization
- Drift detection

---

# Detailed Milestones

---

## M-01 - Foundation & Smart Save

**Objective:** Build stable event capture infrastructure.

**DoD:**
- [ ] Race-condition-free event system
- [ ] Smart save logic
- [ ] Stable schema
- [ ] CPU < 2% average
- [ ] 2-hour stress test passed

---

## M-02 - Semantic Intelligence v1

**DoD:**
- [ ] Goal alignment detection
- [ ] Work vs distraction classification
- [ ] Context switching penalty logic

---

## M-03 - Behavioral & Visual Defense

**DoD:**
- [ ] Behavioral metrics implemented
- [ ] Gaze validation logic
- [ ] Passive reading detection

---

## M-04 - Unified Intelligence & Dashboard

**DoD:**
- [ ] Final Focus Score
- [ ] Attribution breakdown
- [ ] Local dashboard
- [ ] Privacy audit passed

---

## M-05 - Optimization & Personalization

**DoD:**
- [ ] Baseline calibration mode
- [ ] Drift detection
- [ ] Explainability panel
- [ ] Performance optimization pass

---

# Major Dependencies

- OS-level input permissions
- Camera permissions
- Local model loading feasibility
- Cross-platform packaging pipeline

---

# Systemic Risks

- Privacy perception issues
- Performance degradation
- Scoring distrust
- Over-complexity

---

# Change Log

- 2026-02-10 - Roadmap restructured into Strategic + Execution layers.
- 2026-02-03 - Initial roadmap draft created.

