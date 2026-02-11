FINAL SPEC: Phase 1 (Data Collection & Conditional Persistence)

A) Goal
사용자의 디지털 활동 스냅샷을 1초 단위로 감시하되, 상태 변화나 사용자 활동이 있을 때만 데이터를 로컬 JSON 파일에 영구 저장하여 최적화된 데이터셋을 구축함.

B) Core Logic (The "Smart Save" Rule)
매 1초(1000ms)마다 엔진은 아래 조건 중 하나라도 충족되면 저장을 실행한다.

창 전환 (Window Change): 현재 활성 앱(app) 또는 창 제목(title)이 직전 기록과 다른 경우.

활동 발생 (Input Activity): 지난 1초 동안 keystrokes 또는 mouseClicks가 1회 이상 발생한 경우.

위 조건에 해당하지 않는 'Idle' 상태의 데이터는 과감히 버린다.

C) Technical Stack
Runtime: Node.js v14.18.1

Libraries: active-win, uiohook-napi, fs

Storage: focus_logs.json (Array of objects)

D) Data Schema
JSON
{
  "timestamp": "ISO-8601 String",
  "app": "String",
  "title": "String",
  "inputs": {
    "keystrokes": "Number",
    "mouseClicks": "Number"
  }
}
E) Architecture & Implementation Guide
Event Hooking: uiohook을 활용해 전역에서 키보드/마우스 이벤트를 카운팅.

State Tracking: lastSavedState 변수를 두어 현재 상태와 비교 수행.

Atomic Reset: 데이터 저장 직후에는 반드시 keystrokes와 mouseClicks 카운터를 0으로 초기화하여 데이터 중복 합산을 방지함.

File I/O: fs.readFileSync와 fs.writeFileSync를 사용하여 기존 로그 배열을 유지하며 새로운 데이터를 추가함.