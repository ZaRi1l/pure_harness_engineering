# Pure Harness 처음 사용하기

이 문서는 Windows PowerShell 7 기준의 첫 사용 안내입니다. Node.js 20+와 Git이 필요합니다. Pure Harness 설치와 대상 프로젝트는 **서로 다른 Git 저장소의 형제 폴더**에 두세요. 실시간 화면은 선택 사항이며, 별도로 설치·탐색이 확인된 에이전트 지침과 Skill은 서버 없이도 사용할 수 있습니다.

먼저 자신의 상황을 고르세요.

1. **새 빈 프로젝트**라면 [1. 새 프로젝트 시작](#1-새-프로젝트-시작)을 따릅니다.
2. **이미 작업 중인 프로젝트**라면 원본을 보존하고 [2. 격리 복사해 시험하기](#2-기존-프로젝트를-격리-복사해-시험하기)를 따릅니다.

> 이 단계에서 검증되는 것은 프로젝트 식별·별도 runtime·대시보드의 수동 작업 편집입니다. 프로젝트 등록만으로 Codex/Claude Code/OpenCode/Antigravity의 설정, Skill, 훅이 자동 설치되거나 기존 훅 이벤트가 새 runtime으로 전달되지는 않습니다. 따라서 새 프로젝트의 에이전트 그래프와 토큰 텔레메트리가 비어 있을 수 있습니다. 기존 프로젝트의 자동화 전환과 데이터 이관은 아직 지원 절차가 아닙니다.

## 1. 새 프로젝트 시작

1. Pure Harness를 프로젝트 밖의 별도 위치에 설치합니다. 예: `git clone https://github.com/ZaRi1l/pure_harness_engineering.git C:\tools\pure-harness`.
2. [README의 새 프로젝트 PowerShell 명령](../README.md#새-프로젝트를-처음-시작할-때-windows-powershell-7)을 위에서 아래로 실행합니다. 예시의 `$HarnessRoot`, `$ProjectRoot`, `$ProjectId`를 먼저 자신의 환경에 맞게 바꾸세요. 그 명령은 빈 프로젝트에 Git을 만들고, 프로젝트 manifest와 로컬 binding을 만든 뒤 진단 → 초기화 → 상태 조회 → 화면 시작 순서로 진행합니다.
3. 터미널에 나온 localhost 주소에 `#dashboard`를 붙여 열고 [3. 화면에서 첫 작업 확인](#3-화면에서-첫-작업-확인)을 따라 합니다.

기존 디렉터리에는 새 프로젝트용 명령을 그대로 실행하지 마세요. 특히 기존 manifest, binding, `.ai/runtime`, `.codex`, `AGENTS.md`를 지우거나 덮어쓰지 마세요.

## 2. 기존 프로젝트를 격리 복사해 시험하기

원본 프로젝트를 바로 전환하지 않습니다. 아래는 **커밋된 파일만** 가져오는 시험용 복사본입니다. 미커밋 파일과 무시된 데이터는 복사되지 않으므로 원본과 다른 상태일 수 있습니다. 두 대상 경로는 없어야 하고 서로 안에 포함되면 안 됩니다.

```powershell
$ErrorActionPreference = 'Stop'
$HarnessSource = 'C:\path\to\pure_harness_engineering' # 기존 Harness 설치
$ProjectSource = 'C:\path\to\existing-project'  # 기존 프로젝트 Git checkout
$HarnessRoot = 'C:\work\harness-trial'            # 새 시험용 경로
$ProjectRoot = 'C:\work\project-trial'            # 새 시험용 경로
$ProjectId = 'project-trial'                        # 소문자 영문·숫자·하이픈
if (-not (Test-Path -LiteralPath $HarnessSource) -or -not (Test-Path -LiteralPath $ProjectSource)) { throw '원본 경로를 확인하세요.' }
if ((Test-Path -LiteralPath $HarnessRoot) -or (Test-Path -LiteralPath $ProjectRoot)) { throw '시험용 대상 경로가 이미 있습니다. 덮어쓰지 말고 새 경로를 선택하세요.' }
git clone --no-hardlinks --single-branch $HarnessSource $HarnessRoot
if ($LASTEXITCODE -ne 0) { throw 'Harness 복사 실패' }
git clone --no-hardlinks --single-branch $ProjectSource $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw '프로젝트 복사 실패' }
if ((git -C $HarnessRoot remote) -contains 'origin') { git -C $HarnessRoot remote remove origin }
if ((git -C $ProjectRoot remote) -contains 'origin') { git -C $ProjectRoot remote remove origin }
$HarnessRoot = (Resolve-Path $HarnessRoot).Path
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
```

시험용 프로젝트에 이미 `harness-adapter/project.json`이 있다면 덮어쓰지 말고 그 ID와 관리 경로를 읽어 사용하세요. 없다면 아래처럼 **복사본에만** manifest를 만듭니다. 이 파일은 프로젝트에서 추적할 설정이고, 세 관리 경로는 Harness 설치 아래에 만들어집니다.

```powershell
$Manifest = Join-Path $ProjectRoot 'harness-adapter/project.json'
if (Test-Path -LiteralPath $Manifest) {
  $ProjectId = (Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json).id
  if (-not $ProjectId) { throw '기존 manifest의 id를 확인하세요.' }
} else {
  New-Item -ItemType Directory -Path (Split-Path $Manifest -Parent) -Force | Out-Null
  @{
    schemaVersion = 1
    id = $ProjectId
    displayName = 'Project Trial'
    paths = @{
      tasks = "projects/$ProjectId/tasks"
      memory = "projects/$ProjectId/memory"
      runtime = "projects/$ProjectId/runtime"
    }
    adapters = @{}
  } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM $Manifest
}
$Binding = Join-Path $HarnessRoot 'harness-adapter/binding.local.json'
if (Test-Path -LiteralPath $Binding) { throw '기존 binding이 있습니다. 덮어쓰지 말고 등록 내용을 확인하세요.' }
New-Item -ItemType Directory -Path (Split-Path $Binding -Parent) -Force | Out-Null
@{
  schemaVersion = 1
  registrations = @(@{
    projectId = $ProjectId
    harnessRoot = $HarnessRoot
    projectRoot = $ProjectRoot
  })
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM $Binding
```

Harness 시험 복사본에서 실행합니다. `diagnostic`은 읽기 전용입니다. 나머지 명령은 **시험 복사본에만** 상태를 기록합니다. 첫 실패에서 멈추고 오류를 고친 뒤 다시 시작하세요.

```powershell
Set-Location $HarnessRoot
npm test
if ($LASTEXITCODE -ne 0) { throw 'Harness 테스트 실패' }
npm run self-check
if ($LASTEXITCODE -ne 0) { throw 'Harness 자체 점검 실패' }
node scripts/project-diagnostic.mjs --project $ProjectId --checkout $ProjectRoot --binding $Binding
if ($LASTEXITCODE -ne 0) { throw '프로젝트 진단 실패: init 중단' }
npm run init -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
if ($LASTEXITCODE -ne 0) { throw '시험용 runtime 초기화 실패' }
npm run status -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
if ($LASTEXITCODE -ne 0) { throw '상태 조회 실패' }
npm run preview:live -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
```

진단 성공 메시지는 `OK: Project context is valid`입니다. `init`은 시험용 Harness의 manifest에 선언된 runtime 경로에 새 상태를 만듭니다. 기존 프로젝트의 `.ai/runtime`이나 훅은 옮기거나 변경하지 않습니다. 화면 주소는 마지막 명령이 터미널에 출력합니다. 기본 포트 8765가 사용 중이면 마지막 명령 전에 `$env:PURE_HARNESS_PORT = '18765'`처럼 다른 로컬 포트를 지정하세요.

## 3. 화면에서 첫 작업 확인

1. 출력된 주소에 `#dashboard`를 붙여 엽니다. `현재 작업`에서 제목을 입력해 시험 작업 하나를 추가합니다.
2. 작업을 `진행 중`으로 바꿔 저장하고 브라우저를 새로고침합니다. 같은 제목과 상태가 남아 있으면 선택 프로젝트 runtime에 기록된 것입니다.
3. 왼쪽에서 `에이전트 카탈로그`, `스킬 카탈로그`, `Harness 가이드`를 열어봅니다. 언어 버튼으로 한국어/영어를 바꿔봅니다. 카탈로그는 설치된 Harness 저장소 설정을 보여주며, 프로젝트에 자동 설치됐다는 뜻은 아닙니다.
4. 시험이 끝나면 서버를 실행한 터미널에서 `Ctrl+C`로 종료합니다. 시험용 복사본과 원본은 별개입니다.

`실행 중 기록 에이전트`가 0명이거나 토큰 텔레메트리가 비어 있어도 첫 등록·화면 검사는 실패한 것이 아닙니다. 네이티브 AI 세션의 에이전트/훅/rollout 기록을 이 runtime으로 보내는 어댑터는 위 절차에서 설치되지 않습니다. 기존 프로젝트 훅이 자체 `.ai/runtime`에 쓰는 경우 새 Harness의 `projects/<id>/runtime`에는 나타나지 않습니다. **자동 수집까지 확인했다고 보고하지 마세요.**

## 막히면

- `MISSING_FILE`: manifest와 binding의 경로를 확인합니다.
- `INVALID_GIT`: 프로젝트가 Git 저장소의 실제 root인지 확인합니다.
- `NESTED_ROOT`: Harness와 프로젝트가 서로 안에 있지 않은지 확인합니다.
- `MISMATCHED_ID`: `$ProjectId`, manifest의 `id`, binding의 `projectId`를 맞춥니다.
- `PATH_ESCAPE`: `tasks`, `memory`, `runtime`이 `projects/<id>/` 아래의 겹치지 않는 상대 경로인지 확인합니다.
- 화면이 안 열리면 `preview:live` 터미널이 실행 중인지, 그 터미널에 실제 출력된 URL을 사용했는지 확인합니다. `preview/index.html`을 `file://`로 직접 여는 것은 실시간 대시보드 경로가 아닙니다.

실제 기존 프로젝트에 AI 설정·훅을 설치하고 runtime을 전환하는 것은 이 첫 사용 가이드 범위 밖입니다. [전환 게이트](project-isolation-cutover.md)는 현재 닫혀 있으므로 원본 runtime, 작업 명세, 점유, 열린 세션을 삭제하거나 이관하지 마세요.
