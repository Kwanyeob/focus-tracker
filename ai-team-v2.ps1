# ai-team-v2.ps1
# Human-in-the-loop + Gemini iterative design loop -> SPEC lock -> Claude build/QA -> Gemini docs
# Required files:
#   - context.flowstate.md
#   - prompt.md
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\ai-team-v2.ps1
#
# Controls:
#   - You will chat with Gemini via terminal input (review/revise loop)
#   - When you type "LOCK", Gemini produces a final SPEC (input contract)
#   - Then you PASS/REJECT the SPEC
#   - Only after PASS, pipeline continues to Claude and Docs

param(
  [string]$ContextFile = ".\context.flowstate.md",
  [string]$PromptFile  = ".\prompt.md",
  [string]$OutDir      = ".\.ai-team",
  [int]$MaxDesignRounds = 6,
  [switch]$NoQA,
  [switch]$NoDocs
)

$ErrorActionPreference = "Stop"

function Assert-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Command not found: '$name'. Make sure it's installed and in PATH."
  }
}

function Read-FileOrThrow($path) {
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  return Get-Content $path -Raw
}

function Ensure-Dir($path) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

function Save-Out($dir, $name, $text) {
  $path = Join-Path $dir $name
  $text | Out-File -Encoding utf8 $path
  return $path
}

function Prompt-Choice($msg, $choices) {
  while ($true) {
    $ans = (Read-Host $msg).Trim()
    foreach ($c in $choices) { if ($ans.ToUpper() -eq $c.ToUpper()) { return $ans } }
    Write-Host ("Allowed: " + ($choices -join ", ")) -ForegroundColor Yellow
  }
}

Assert-Cmd "gemini"
Assert-Cmd "claude"

$context = Read-FileOrThrow $ContextFile
$task    = Read-FileOrThrow $PromptFile

Ensure-Dir $OutDir
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutDir $ts
Ensure-Dir $runDir

Write-Host "✅ AI Team v2 시작: $runDir" -ForegroundColor Green
Write-Host "   - Design loop (Gemini) -> LOCK -> SPEC PASS gate -> Claude build/QA -> Gemini docs" -ForegroundColor Green
Write-Host ""

# ---------------------------
# Step 1: Gemini Design Loop (Chat-style)
# ---------------------------
# We keep a "conversation transcript" that we feed back to Gemini each round.
$transcript = @()
$round = 1

# Initial design seed prompt
$seedPrompt = @"
ROLE: You are Gemini acting as Product Manager + System Architect for Flow-State Engine.

PROJECT CONTEXT (do not ignore):
$context

CURRENT TASK:
$task

You will collaborate with the user (CTO) iteratively.
At each round:
- Propose a DESIGN DRAFT in a structured format (see below).
- Then ask the user what to change.
- The user may respond with revisions, or type LOCK to finalize.

DESIGN DRAFT FORMAT:
1) MVP scope (bullets)
2) Architecture (modules, boundaries, data flow)
3) Data schema (JSON examples)
4) Implementation plan (ordered steps)
5) Risks / privacy pitfalls / edge cases
6) Open questions (if any, keep short)

After the draft, ask:
"Reply with revisions, or type LOCK to generate FINAL SPEC."

Constraints:
- Privacy-first, local-only
- Actionable, implementation-friendly
"@

Write-Host "== Step 1: Gemini Design Loop ==" -ForegroundColor Cyan
Write-Host "Tip: 수정 요구사항을 한국어로 써도 됨. 만족하면 'LOCK' 입력." -ForegroundColor DarkGray
Write-Host ""

$lastGemini = gemini $seedPrompt
$transcript += "=== GEMINI ROUND 1 ===`n$lastGemini"
Save-Out $runDir "01_gemini_design_round01.md" $lastGemini | Out-Null

while ($round -lt $MaxDesignRounds) {
  Write-Host ""
  Write-Host "---- ROUND $round OUTPUT SAVED ----" -ForegroundColor DarkGray
  Write-Host "이 설계에서 바꾸고 싶은 점을 적거나, 만족하면 LOCK 입력" -ForegroundColor Yellow

  $userMsg = Read-Host "YOU"
  if ($userMsg.Trim().ToUpper() -eq "LOCK") { break }

  $round++
  $transcript += "=== USER ROUND $round REQUEST ===`n$userMsg"

  $loopPrompt = @"
ROLE: You are Gemini acting as PM + Architect.

PROJECT CONTEXT:
$context

TASK:
$task

CONVERSATION TRANSCRIPT (most recent last):
$($transcript -join "`n`n")

USER REQUEST (apply changes):
$userMsg

Now produce an updated DESIGN DRAFT in the same format.
Then ask again: "Reply with revisions, or type LOCK to generate FINAL SPEC."
"@

  Write-Host "== Gemini updating draft (round $round) ==" -ForegroundColor Cyan
  $lastGemini = gemini $loopPrompt
  $transcript += "=== GEMINI ROUND $round ===`n$lastGemini"
  Save-Out $runDir ("01_gemini_design_round{0:D2}.md" -f $round) $lastGemini | Out-Null
}

# ---------------------------
# Step 1.5: Gemini FINAL SPEC generation
# ---------------------------
Write-Host ""
Write-Host "== Step 1.5: Generate FINAL SPEC (Gemini) ==" -ForegroundColor Cyan

$finalSpecPrompt = @"
ROLE: You are Gemini. Generate the FINAL SPEC for engineering execution.

PROJECT CONTEXT:
$context

TASK:
$task

CONVERSATION TRANSCRIPT (most recent last):
$($transcript -join "`n`n")

GOAL:
Generate a FINAL SPEC that is concise, unambiguous, and ready to pass to Claude.

FINAL SPEC FORMAT (strict):
A) Goal (1-2 sentences)
B) In-scope / Out-of-scope
C) Acceptance criteria (checklist)
D) Architecture decisions (bullets)
E) File/module plan (expected paths; can be tentative)
F) Data schema (JSON examples)
G) Privacy & security rules (must follow)
H) Test plan outline
I) Non-goals / future work

Do not ask questions. Make reasonable assumptions and list them explicitly.
"@

$finalSpec = gemini $finalSpecPrompt
$finalSpecPath = Save-Out $runDir "02_final_spec.md" $finalSpec

Write-Host "🧾 FINAL SPEC 생성됨: $finalSpecPath" -ForegroundColor Green
Write-Host "이제 SPEC을 검수하고 PASS해야 다음 단계로 진행됨." -ForegroundColor Yellow
Write-Host ""

# PASS gate
$pass = Prompt-Choice "PASS to proceed? (PASS/REJECT)" @("PASS","REJECT")
if ($pass.Trim().ToUpper() -ne "PASS") {
  Write-Host "❌ 중단됨. REJECT 선택. prompt.md/요구사항 수정 후 다시 실행하거나, 다음엔 설계 루프에서 계속 다듬고 LOCK 하세요." -ForegroundColor Red
  exit 1
}

# ---------------------------
# Step 2: Claude Implementation using FINAL SPEC
# ---------------------------
Write-Host ""
Write-Host "== Step 2: Claude -> Implementation ==" -ForegroundColor Cyan

$claudeBuildPrompt = @"
ROLE: You are Claude acting as Senior Engineer.

PROJECT CONTEXT:
$context

FINAL SPEC (authoritative):
$finalSpec

HARD REQUIREMENTS:
- Output MUST be organized as:
  A) File plan (exact file paths to create/modify)
  B) Code for each file with fenced code blocks
  C) Commands to run / test
  D) Notes on privacy & data handling
- Do NOT store sensitive content (no raw keystroke content, no raw webcam frames saved to disk)
- Prefer TypeScript for Electron/Node modules
- Keep modules small and composable
- If repo structure is unknown, state assumptions and still provide runnable code

Deliver production-quality code with clear comments.
"@

$impl = $claudeBuildPrompt | claude
Save-Out $runDir "03_claude_implementation.md" $impl | Out-Null

# ---------------------------
# Step 3: Claude QA
# ---------------------------
$qa = ""
if (-not $NoQA) {
  Write-Host ""
  Write-Host "== Step 3: Claude -> QA ==" -ForegroundColor Cyan

  $claudeQAPrompt = @"
ROLE: You are Claude acting as QA Engineer + Debug Specialist.

PROJECT CONTEXT:
$context

FINAL SPEC:
$finalSpec

IMPLEMENTATION OUTPUT:
$impl

OUTPUT:
1) Bug risks / missing pieces (ranked)
2) Edge cases checklist
3) Test plan (unit + integration + manual)
4) Performance/battery considerations
5) Security & privacy audit checklist
Reference file paths where possible.
"@

  $qa = $claudeQAPrompt | claude
  Save-Out $runDir "04_claude_qa.md" $qa | Out-Null
} else {
  Save-Out $runDir "04_claude_qa.md" "" | Out-Null
}

# ---------------------------
# Step 4: Gemini Docs
# ---------------------------
if (-not $NoDocs) {
  Write-Host ""
  Write-Host "== Step 4: Gemini -> Docs ==" -ForegroundColor Cyan

  $docsPrompt = @"
ROLE: You are Gemini acting as Technical Writer.

PROJECT CONTEXT:
$context

FINAL SPEC:
$finalSpec

IMPLEMENTATION OUTPUT:
$impl

QA NOTES:
$qa

OUTPUT:
- README sections in Markdown:
  * What was built (Phase 1)
  * How to run / test
  * Data privacy guarantee (explicit)
  * Troubleshooting
- Short changelog summary
- Next steps suggestions aligned to roadmap (Phase 2+)
Keep it repo-friendly and concise.
"@

  $docs = gemini $docsPrompt
  Save-Out $runDir "05_gemini_docs.md" $docs | Out-Null
} else {
  Save-Out $runDir "05_gemini_docs.md" "" | Out-Null
}

Write-Host ""
Write-Host "🎉 완료! 결과 저장됨: $runDir" -ForegroundColor Green
Write-Host "Files:" -ForegroundColor Green
Write-Host "  01_gemini_design_round*.md"
Write-Host "  02_final_spec.md"
Write-Host "  03_claude_implementation.md"
Write-Host "  04_claude_qa.md"
Write-Host "  05_gemini_docs.md"
