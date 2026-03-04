# EPIC-01 - Semantic Context (NLP) + Active Goal MVP Spec (v0.3)

## Performance / Adaptive / Guardrails Enhanced Version

## Objective

Determine, locally and in real time, whether the user's Active Deep Work Goal (single goal) semantically aligns with their current digital activity (`application name + window title`).

Output:

- `On-goal`
- `Related`
- `Off-goal`
- Confidence level

## Privacy Constraints

- No keystroke content logging
- No webpage body / DOM analysis
- No OCR
- Fully local processing

## Design Philosophy

This system is:

- Not an LLM
- Not a complex language understanding system
- A lightweight semantic matching engine using short text plus app context projected into vector space

Design targets:

- Approximately `90%` perceived accuracy
- Low CPU overhead
- Fully local inference

## 1. Normalization and Embedding Strategy

### 1.1 App Name Prefix (Mandatory)

Problem:

A title like:

```txt
index.js
```

contains almost no semantic meaning.

Solution:

During normalization, always transform into:

```txt
"{app_name} | {clean_title}"
```

Examples:

```txt
index.js
-> Visual Studio Code | index.js

Pull Request #231
-> GitHub Desktop | Pull Request #231

LeetCode - Two Sum
-> Google Chrome | LeetCode - Two Sum
```

This forces embeddings into the correct semantic cluster (for example, development / coding).

App prefixing is mandatory in the MVP.

### 1.2 Multilingual Model Selection

For environments where Korean and English are mixed, use:

```txt
paraphrase-multilingual-MiniLM-L12-v2
```

Using an English-only model may incorrectly classify Korean titles as `Off-goal`.

### 1.3 Quantization (Critical for Performance)

When loading the model in `Transformers.js`:

```js
quantized: true
```

Benefits:

- Model size reduced to about `1/4`
- Significant CPU speed improvement
- Suitable for local inference

Quantized mode is mandatory for MVP.

## 2. Embedding Invocation Strategy (CPU Protection)

### 2.1 Debounce-Based Embedding Calls

Problem:

Rapid tab switching can trigger embedding computation for very short windows, causing CPU spikes.

Solution:

Step 1:

On window change:

- Snapshot `app_name` and `window_title`
- Set state to `transition`

Step 2:

Only if the window remains active for at least `2 seconds`:

- Call `EmbeddingService`

Rules:

- Dwell `< 1 second`
  - No embedding computation
  - Label = `unknown`
- Dwell `1-2 seconds`
  - Low confidence
  - Embedding optional (MVP may skip)
- Dwell `>= 2 seconds`
  - Perform embedding

### 2.2 LRU Cache Policy

Embedding cache key:

```txt
normalized_text
```

Embeddings are goal-independent.
If the goal changes, the same text embedding can still be reused.

Important:

If caching final scores or labels, the cache key must be:

```txt
(goal_id, normalized_text)
```

## 3. Scoring Engine (Hybrid Model)

### 3.1 Base Similarity

```txt
sim = cosine(goal_vector, window_vector)
```

### 3.2 Heuristic Boost

#### App Boost Examples

| App Context | Boost |
|---|---:|
| VSCode / IntelliJ | +0.15 |
| Terminal | +0.12 |
| Chrome (leetcode) | +0.20 |
| YouTube | -0.30 |
| Netflix | -0.40 |

#### Keyword Boost Examples

Positive:

- `leetcode`
- `sql`
- `pull request`
- `jira`
- `design doc`

Negative:

- `youtube`
- `shorts`
- `netflix`
- `tiktok`

### 3.3 Final Score

```txt
final = clamp(sim + app_boost + keyword_boost, 0, 1)
```

## 4. Adaptive Threshold (Hybrid Absolute + Relative)

### 4.1 Fixed Defaults

```txt
T_on  = 0.62
T_off = 0.48
```

### 4.2 Relative Calibration (If Daily Data Is Sufficient)

```txt
T_on  = 80th percentile of final scores
T_off = 50th percentile of final scores
```

### 4.3 Distraction-Day Guardrail

If the daily average `final_score < 0.3`:

- Do not apply relative calibration
- Use fixed thresholds

This prevents distortion on days dominated by unrelated activity.

### 4.4 Global Floor

`T_on` must never drop below `0.50`.

If calibration results in:

```txt
T_on < 0.50
```

Then:

```txt
T_on = 0.50
```

This prevents the system from labeling nearly everything as `On-goal`.

## 5. Dwell and Context Switching Guardrails

### 5.1 Debounce Confirmation Window

Label is not finalized immediately.

It must remain stable for at least `3 seconds` before being confirmed.

### 5.2 Confidence Levels

| Dwell Time | Confidence |
|---|---|
| `< 2s` | `unknown` |
| `2-10s` | `low` |
| `10-30s` | `medium` |
| `> 30s` | `high` |

For reporting:

- `unknown` excluded
- `low` may be down-weighted

## 6. SQLite Optimization

Add composite index to `window_sessions`:

```sql
CREATE INDEX idx_goal_label_time
ON window_sessions (goal_id, label, start_ts_utc);
```

Benefit:

Efficient queries like:

```txt
Total On-goal time for today under current goal
```

Additional recommended indexes:

```sql
CREATE INDEX idx_label_time
ON window_sessions (label, start_ts_utc);

CREATE INDEX idx_goal_time
ON window_sessions (goal_id, start_ts_utc);
```

## 7. Full Processing Flow

1. Active Goal is set
2. Goal embedding is generated (quantized multilingual model)
3. Window change detected
4. Debounce timer starts
5. If window remains active for at least `2 seconds`:
   - Normalize (App Prefix included)
   - Compute embedding (LRU cache)
   - Compute cosine similarity
   - Apply heuristic boosts
   - Apply thresholds
   - Finalize label
   - Attach semantic label to dwell session
   - Persist to SQLite

## 8. MVP Implementation Order

1. Multilingual quantized embedding integration
2. `TitleNormalizer` with mandatory App Prefix
3. Debounce-based embedding invocation
4. Heuristic boost plus fixed thresholds
5. SQLite migration plus composite indexes
6. Adaptive threshold with Global Floor

## Final Outcome

This design ensures:

- Multilingual safety
- CPU spike prevention
- Adaptive distortion protection
- Large-scale SQLite performance
- Architectural alignment with FocusTracker
