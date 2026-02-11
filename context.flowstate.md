# Flow-State Engine (Focus AI) - Project Context

## Vision
Wearable 없이 소프트웨어 센싱만으로 Deep Work(몰입) 상태를 0~100 점수로 실시간 산출.
Privacy-first: 모든 처리 로컬(on-device), 민감 데이터는 저장/전송하지 않음.

## 3-Layer Sensing
### Layer 1: Semantic Context (40%)
- Goal 텍스트 vs 현재 앱/창제목/탭제목 의미 유사도 (Sentence-BERT/경량 로컬 모델)
- Window Title 분석 (OS Accessibility API / active window title)
- Context switching 빈도/체류시간 기반 패널티

### Layer 2: Behavioral Dynamics (40%)
- Typing rhythm/WPM/Backspace, 입력 간격 안정성
- Mouse kinematics (jitter/entropy vs linear)
- Scroll pattern (reading vs skimming)

### Layer 3: Visual Attention (20%, optional)
- Webcam gaze tracking (MediaPipe Face Mesh/OpenCV)
- 영상 저장 X, 좌표만 RAM에서 처리 후 폐기

## Edge Case Defense
- 입력 없어도 reading/ gaze on-screen이면 집중 유지
- 유튜브라도 tutorial/IDE 동시 사용 등은 업무로 인정
- 멀티모니터: 커서/시선이 머무는 모니터를 주 대상으로 평가

## Roadmap
Phase 1: Electron + active-win + uiohook-napi 기반 추적 엔진 (Win/Mac)
Phase 2: NLP Semantic mapping (local)
Phase 3: Vision 통합 + Passive work defense
Phase 4: 개인화 모델(Anomaly detection) + 피드백 루프

## Tech Stack (MVP)
- Electron (TS/Node)
- active-win, uiohook-napi
- Local DB: lowdb(JSON)
- NLP: transformers.js or local embedding (light)
- Vision: MediaPipe (optional)

## Non-negotiables
- Local processing only
- Minimal sensitive logging (가능하면 메트릭만 저장)
- 코드/구조는 확장 가능하게 모듈화
