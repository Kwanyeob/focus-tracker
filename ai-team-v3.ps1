# ai-team-v3.ps1
# Gemini 설계 -> SPEC 승인 -> Claude 코드 생성 -> 실제 파일 생성 -> QA -> Docs

param(
  [string]$ContextFile = ".\context.flowstate.md",
  [string]$PromptFile  = ".\prompt.md",
  [string]$OutDir      = ".\.ai-team",
  [switch]$DryRun,
  [switch]$NoQA,
  [switch]$NoDocs
)

$ErrorActionPreference = "Stop"

function Assert-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $name"
  }
}

function ReadFile($path) {
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  return Get-Content $path -Raw
}

function SaveFile($dir, $name, $content) {
  $path = Join-Path $dir $name
  $content | Out-File -Encoding utf8 $path
  return $path
}

function Parse-ClaudeFiles($text) {
  $files = @()
  $regex = [regex]"(?ms)### FILE:\s*(.+?)\s*`[a-zA-Z]*\s*(.*?)\s*"
  foreach ($m in $regex.Matches($text)) {
    $files += [pscustomobject]@{
      Path = $m.Groups[1].Value.Trim()
      Code = $m.Groups[2].Value
    }
  }
  return $files
}

function Apply-Files($files, $root) {
  foreach ($f in $files) {
    $full = Join-Path $root $f.Path
    $dir  = Split-Path $full -Parent
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    if ($DryRun) {
      Write-Host "DryRun → would write $($f.Path)" -ForegroundColor Yellow
    } else {
      Set-Content -Path $full -Value $f.Code -Encoding utf8
      Write-Host " Wrote $($f.Path)" -ForegroundColor Green
    }
  }
}

# ---------- START ----------
Assert-Cmd "gemini"
Assert-Cmd "claude"

$context = ReadFile $ContextFile
$task    = ReadFile $PromptFile

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutDir $ts
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

Write-Host "Start AI Team v3 Pipeline" -ForegroundColor Cyan

# ---------- Step 1: Gemini 설계 ----------
$designPrompt = @"
ROLE: Product Manager + Architect

PROJECT CONTEXT:
$context

TASK:
$task

Provide:
1. MVP scope
2. Architecture
3. Data schema
4. Implementation steps
5. Risks & edge cases
"@

$design = gemini "$designPrompt"
SaveFile $runDir "01_design.md" $design | Out-Null

$resp = Read-Host "Design OK? Continue to SPEC (Y/N)"
if ($resp -ne "Y") { exit }

# ---------- Step 2: FINAL SPEC ----------
$specPrompt = "Turn this design into FINAL SPEC for engineers.`n$design"
$spec = gemini "$specPrompt"
SaveFile $runDir "02_final_spec.md" $spec | Out-Null

$pass = Read-Host "PASS SPEC? (PASS/STOP)"
if ($pass -ne "PASS") { exit }

# ---------- Step 3: Claude 구현 ----------
$claudePrompt = @"
ROLE: Senior Engineer

PROJECT CONTEXT:
$context

SPEC:
$spec

You must output files like this:

### FILE: path/to/file.ts
(code block)

Repeat for each file.
"@

$impl = claude "$claudePrompt"
SaveFile $runDir "03_claude_impl.md" $impl | Out-Null

# ---------- Step 4: 파일 생성 ----------
$files = Parse-ClaudeFiles $impl
Write-Host "Parsed files: $($files.Count)"

$apply = Read-Host "Apply these files to project? (APPLY/CANCEL)"
if ($apply -eq "APPLY") {
  Apply-Files $files (Get-Location).Path
}

# ---------- Step 5: QA ----------
if (-not $NoQA) {
  $qaPrompt = "QA review this implementation:`n$impl"
  $qa = claude "$qaPrompt"
  SaveFile $runDir "04_qa.md" $qa | Out-Null
}

# ---------- Step 6: Docs ----------
if (-not $NoDocs) {
  $docsPrompt = "Create README + setup instructions:`n$impl"
  $docs = gemini "$docsPrompt"
  SaveFile $runDir "05_docs.md" $docs | Out-Null
}

Write-Host "AI Team v3 Pipeline started"
