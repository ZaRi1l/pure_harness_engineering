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

## 4. AI 도구별 설정 점검

아래 명령은 Harness 설치 디렉터리에서 **도구 하나를 선택해 후보와 차단 이유를 확인**합니다. `$Target`을 `codex`, `claude`(Claude Code), `opencode`, `antigravity` 중 하나로 바꾸세요. 네 도구를 한꺼번에 점검하려면 `--targets all`도 가능합니다. 각 줄을 개별 실행하고 종료 코드와 메시지를 읽으세요.

```powershell
Set-Location $HarnessRoot
$Target = 'claude' # codex / claude / opencode / antigravity 중 하나
node scripts/detect-targets.mjs --root $ProjectRoot --json
node scripts/validate.mjs --targets $Target --profile core --json
node scripts/sync.mjs --targets $Target --profile core --dry-run
node scripts/sync.mjs --targets $Target --profile core --check
```

`detect-targets`는 선택 프로젝트의 **설정 파일 표식만** 찾으며 AI 프로그램 설치·버전·실행 가능 여부를 확인하지 않습니다. `validate`와 `sync --check`는 현재 생성 manifest와 네이티브 스모크 근거가 없어 0이 아닌 상태로 끝날 수 있습니다. `--dry-run`은 후보 경로와 기존 파일 충돌을 보여줍니다. 이 세 명령은 설정 파일을 생성·설치하지 않습니다. `--profile core`는 최소 역할·Skill 후보, `--profile all`은 전체 후보입니다.

현재는 네 대상 모두 [네이티브 스모크 절차](native-smoke-worksheet.md)가 미검증이라 일반 쓰기 명령 `node scripts/sync.mjs --targets $Target --profile core`는 차단됩니다. `--force` 같은 우회 명령도 없습니다. 나중에 역할 파일 생성이 검증되더라도 그것만으로 루트 지침, 훅, Skill 탐색, 기존 프로젝트 runtime 연결까지 설치되는 것은 아닙니다. 실제 전환 전에 대상 도구에서 역할 호출·Skill 탐색·유효 권한을 독립 검증하고 [전환 게이트](project-isolation-cutover.md)를 통과해야 합니다.

## 5. 첫 AI 작업과 수동 토큰 가져오기

AI 프로그램에서 **대상 프로젝트 checkout인 `$ProjectRoot`**를 열어 첫 요청을 해보세요. 예: “README를 읽고 이 프로젝트의 실행 방법을 파일 변경 없이 설명해줘.” 먼저 그 프로그램이 프로젝트의 에이전트 지침·역할·Skill을 실제로 읽는지 확인해야 합니다. Harness 설치 폴더에서 대화하거나 manifest만 등록했다고 그 설정이 프로젝트에 설치되지는 않습니다. 첫 대화가 정상이어도 대시보드에 에이전트가 자동 표시된다는 뜻은 아닙니다.

Codex의 **해당 프로젝트 세션에서 나온** rollout JSONL 파일의 절대경로를 이미 알고 있다면 아래처럼 토큰 집계를 수동으로 가져올 수 있습니다. 원본 JSONL은 읽기 전용이고 집계 snapshot은 선택한 Harness runtime에 기록됩니다.

```powershell
Set-Location $HarnessRoot
$RolloutFile = 'C:\path\to\rollout.jsonl' # 자신의 Codex rollout JSONL 절대경로
if (-not (Test-Path -LiteralPath $RolloutFile -PathType Leaf)) { throw 'rollout 파일 경로를 확인하세요.' }
node scripts/import-telemetry.mjs --project $ProjectId --checkout $ProjectRoot --binding $Binding --file $RolloutFile
if ($LASTEXITCODE -ne 0) { throw '토큰 집계 가져오기 실패' }
```

파일이 여러 개면 `--file <절대경로>`를 반복해 **같은 명령에 모두** 넣으세요. 실행할 때마다 선택한 파일 집합의 집계로 snapshot을 교체하며 자동 감시·증분 갱신은 하지 않습니다. 다른 프로젝트나 무관한 세션 파일을 섞으면 전체 수치가 오해를 부를 수 있습니다. 정확한 네이티브 child ID 연결 근거가 없으면 일부 비용은 `unattributed`로 남습니다. 이 가져오기는 **Codex rollout 전용**이고 다른 세 도구의 토큰 수집을 지원한다고 뜻하지 않습니다.

## 막히면

- `MISSING_FILE`: manifest와 binding의 경로를 확인합니다.
- `INVALID_GIT`: 프로젝트가 Git 저장소의 실제 root인지 확인합니다.
- `NESTED_ROOT`: Harness와 프로젝트가 서로 안에 있지 않은지 확인합니다.
- `MISMATCHED_ID`: `$ProjectId`, manifest의 `id`, binding의 `projectId`를 맞춥니다.
- `PATH_ESCAPE`: `tasks`, `memory`, `runtime`이 `projects/<id>/` 아래의 겹치지 않는 상대 경로인지 확인합니다.
- 화면이 안 열리면 `preview:live` 터미널이 실행 중인지, 그 터미널에 실제 출력된 URL을 사용했는지 확인합니다. `preview/index.html`을 `file://`로 직접 여는 것은 실시간 대시보드 경로가 아닙니다.

실제 기존 프로젝트에 AI 설정·훅을 설치하고 runtime을 전환하는 것은 이 첫 사용 가이드 범위 밖입니다. [전환 게이트](project-isolation-cutover.md)는 현재 닫혀 있으므로 원본 runtime, 작업 명세, 점유, 열린 세션을 삭제하거나 이관하지 마세요.
