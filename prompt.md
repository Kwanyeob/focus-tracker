이번 스프린트 작업:
Phase 1 MVP의 "Active Window + Input Metrics" 수집 엔진을 Electron/TypeScript로 구현해줘.

요구사항:
- Windows/Mac 크로스플랫폼 고려 (우선은 구현이 가능한 범위에서)
- active-win으로 app_name + window_title을 주기적으로 수집
- uiohook-napi로 keystrokes / mouse clicks / mouse move distance (대략) 수집
- lowdb(JSON)로 1초 단위 aggregate 로그 저장 (raw keystroke 내용 저장 금지)
- 모듈 구조:
  - src/sensors/windowSensor.ts
  - src/sensors/inputSensor.ts
  - src/storage/logStore.ts
  - src/engine/aggregator.ts
  - src/index.ts
- 간단한 테스트/실행 가이드 포함
- 프라이버시 원칙을 README에 명확히 써줘
