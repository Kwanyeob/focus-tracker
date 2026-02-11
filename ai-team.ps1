# ai-team.ps1
# VS Code + PowerShell: Gemini <-> Claude pipeline runner
# Files:
#   - context.flowstate.md (project context)
#   - prompt.md            (current task)
# Output:
#   - .ai-team/<timestamp>/*.md

param(
  [string]$ContextFile = ".\context.flowstate.md",
  [string]$PromptFile  = ".\prompt.md",
  [string]$OutDir      = ".\.ai-team",
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

Assert-Cmd "gemini"
Assert-Cmd "claude"

$context = Read-FileOrThrow $ContextFile
$task    = Read-FileOrThrow $PromptFile

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutDir $ts
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Save-Out($name, $text) {
  $path = Join-Path $runDir $name
  $text | Out-File -Encoding utf8 $path
  return $path
}

Write-Host "✅ AI Team Pipeline 시작: $runDir" -ForegroundColor Green

# ---------------------------
# Step 1: Gemini (PM + Architect)
# ---------------------------
$geminiDesignPrompt = @"
ROLE: You are Gemini acting as Product Manager + System Architect for Flow-State Engine.

PROJECT CONTEXT (do not ignore):
$context

CURRENT TASK:
$task

OUTPUT FORMAT (strict):
1) MVP scope (bullets)
2) Architecture proposal (modules, boundaries, data flow)
3) Data schema (JSON examples for Phase 1)
4) Implementation plan (step-by-step, ordered)
5) Risks / privacy pitfalls / edge cases (bullets)
6) Acceptance criteria (clear check-list)

Constraints:
- Privacy-first, local-only
- Keep it actionable and implementation-friendly
"@

Write-Host "== Step 1/4: Gemini -> Design/PM ==" -ForegroundColor Cyan
$design = gemini $geminiDesignPrompt
Save-Out "01_gemini_design.md" $design | Out-Null

# ---------------------------
# Step 2: Claude (Senior Engineer -> code)
# ---------------------------
$claudeBuildPrompt = @"
ROLE: You are Claude acting as Senior Engineer.

PROJECT CONTEXT:
$context

DESIGN FROM GEMINI:
$design

TASK:
Implement the requested changes in a repository.

HARD REQUIREMENTS:
- Output MUST be organized as:
  A) File plan (list exact file paths to create/modify)
  B) Code for each file with fenced code blocks
  C) Commands to run / test
  D) Notes on privacy & data handling
- Do NOT store sensitive data (no keystroke content, no raw webcam frames on disk)
- Prefer TypeScript for Electron/Node modules if relevant
- Keep modules small and composable

If any repo files are unknown, make reasonable assumptions and clearly state them.
"@

Write-Host "== Step 2/4: Claude -> Implementation ==" -ForegroundColor Cyan
$codeOut = $claudeBuildPrompt | claude
Save-Out "02_claude_implementation.md" $codeOut | Out-Null

# ---------------------------
# Step 3: Claude (QA / Debug)
# ---------------------------
$qaOut = ""
if (-not $NoQA) {
  $claudeQAPrompt = @"
ROLE: You are Claude acting as QA Engineer + Debug Specialist.

PROJECT CONTEXT:
$context

IMPLEMENTATION OUTPUT:
$codeOut

OUTPUT:
1) Bug risks / missing pieces (ranked)
2) Edge cases checklist
3) Test plan (unit + integration + manual)
4) Performance / battery considerations
5) Security & privacy audit checklist
Be specific and reference file paths where possible.
"@

  Write-Host "== Step 3/4: Claude -> QA ==" -ForegroundColor Cyan
  $qaOut = $claudeQAPrompt | claude
  Save-Out "03_claude_qa.md" $qaOut | Out-Null
} else {
  Write-Host "== Step 3/4: Skipped QA ==" -ForegroundColor Yellow
  Save-Out "03_claude_qa.md" "" | Out-Null
}

# ---------------------------
# Step 4: Gemini (Docs / README)
# ---------------------------
if (-not $NoDocs) {
  $geminiDocsPrompt = @"
ROLE: You are Gemini acting as Technical Writer.

PROJECT CONTEXT:
$context

DESIGN:
$design

IMPLEMENTATION OUTPUT:
$codeOut

QA NOTES:
$qaOut

OUTPUT:
- README section(s) in Markdown:
  * What this module does (Phase 1)
  * How to run (dev)
  * Data privacy guarantee (very explicit)
  * Troubleshooting
- Short changelog summary
- Next steps for Phase 2 (Semantic layer) suggestions
Keep it clean and repository-friendly.
"@

  Write-Host "== Step 4/4: Gemini -> Docs ==" -ForegroundColor Cyan
  $docs = gemini $geminiDocsPrompt
  Save-Out "04_gemini_docs.md" $docs | Out-Null
} else {
  Write-Host "== Step 4/4: Skipped Docs ==" -ForegroundColor Yellow
  Save-Out "04_gemini_docs.md" "" | Out-Null
}

Write-Host ""
Write-Host "🎉 완료! 결과 저장됨:" -ForegroundColor Green
Write-Host "  $runDir" -ForegroundColor Green
Write-Host ""
Write-Host "생성 파일:" -ForegroundColor Green
Write-Host "  01_gemini_design.md"
Write-Host "  02_claude_implementation.md"
Write-Host "  03_claude_qa.md"
Write-Host "  04_gemini_docs.md"
