# Pure Harness v1.1.1

Pure Harness는 Codex 중심의 가벼운 작업 흐름 도구입니다. Main Codex가 조율을 판단하고, Skill은 반복 가능한 절차를 제공하며, 독립된 맥락이나 판단이 도움이 될 때만 전문 에이전트를 사용합니다. 스크립트와 훅은 결정론적 상태 기록과 점검을 담당합니다. Node.js는 가벼운 스크립트와 훅에 사용하지만 일반 사용에 상주 서버는 필요하지 않습니다. 서버는 선택적인 실시간 대시보드용입니다.

## 처음 사용하는 분

코드를 분석할 필요 없이 [처음 사용 가이드](docs/first-use.md)에서 자신의 경우를 선택하세요.

| 상황 | 먼저 할 일 |
| --- | --- |
| 새 빈 Git 프로젝트를 시작 | [아래의 새 프로젝트 설정](#새-프로젝트를-처음-시작할-때-windows-powershell-7)을 순서대로 실행 |
| 이미 작업 중인 프로젝트에 시험 적용 | [기존 프로젝트를 격리 복사해 시험하기](docs/first-use.md#2-기존-프로젝트를-격리-복사해-시험하기)부터 시작. 원본 설정과 runtime은 건드리지 않음 |

현재 이 절차로 확인할 수 있는 것은 **프로젝트 등록·진단, 별도 runtime, 대시보드와 수동 작업 편집**입니다. 프로젝트 manifest의 `"adapters": {}`만으로 AI 설정·훅이 설치되지는 않습니다. 기존 프로젝트의 훅이 자체 runtime을 기록한다면 이 대시보드로 자동 전달되지 않으며, 에이전트와 토큰 텔레메트리 화면이 비어 있어도 등록 실패를 뜻하지 않습니다. 기존 프로젝트의 자동화 전환·runtime 이관은 아직 [전환 게이트](docs/project-isolation-cutover.md)에서 막혀 있습니다.

Codex, Claude Code, OpenCode, Antigravity 중 사용할 도구의 **후보 설정과 현재 차단 이유**는 [도구별 점검 명령](docs/first-use.md#4-ai-도구별-설정-점검)으로 확인할 수 있습니다. 지금은 설정 파일을 한 번에 바꿔 설치하는 단계가 아닙니다.

AI 작업은 Harness 설치가 아닌 **대상 프로젝트 checkout에서** 시작합니다. [첫 AI 작업과 수동 토큰 가져오기](docs/first-use.md#5-첫-ai-작업과-수동-토큰-가져오기)는 선택 사항이며, 자동 수집과 다릅니다.

## 시작하기

### 새 프로젝트를 처음 시작할 때 (Windows PowerShell 7)

이 절차는 **아직 Pure Harness runtime이 없는 새 Git 프로젝트**를 위한 예시입니다. Node.js 20+와 Git이 필요합니다. 먼저 이 Pure Harness 저장소를 별도 경로에 clone(예: `git clone https://github.com/ZaRi1l/pure_harness_engineering.git C:\tools\pure-harness`)하거나 이미 clone한 설치를 사용하세요. 엔진 설치와 프로젝트 Git checkout은 서로 안에 두지 않습니다. 아래 두 절대경로를 자신의 환경에 맞게 바꾸고, 빈 프로젝트 디렉터리에서만 시작하세요. 이미 작업 중인 프로젝트에 붙이거나 기존 runtime을 옮기는 경우에는 아래 `init`을 실행하지 말고 [프로젝트 분리 전환 게이트](docs/project-isolation-cutover.md)를 먼저 검토하세요.

```powershell
$ErrorActionPreference = 'Stop'
$HarnessRoot = 'C:\tools\pure-harness' # 이 저장소의 별도 로컬 설치 경로
$ProjectRoot = 'C:\work\my-project'   # 새 빈 프로젝트 경로
$ProjectId = 'my-project'               # 소문자 영문으로 시작, 이후 영문·숫자·하이픈만
$HarnessRoot = (Resolve-Path $HarnessRoot).Path
if (Test-Path $ProjectRoot) { throw '프로젝트 경로가 이미 존재합니다. 새 빈 경로를 선택하세요.' }
New-Item -ItemType Directory -Path (Split-Path $ProjectRoot -Parent) -Force | Out-Null
New-Item -ItemType Directory -Path $ProjectRoot | Out-Null
Set-Location $ProjectRoot
git init
if ($LASTEXITCODE -ne 0) { throw 'Git 초기화 실패' }
$ProjectRoot = (Resolve-Path .).Path
New-Item -ItemType Directory -Path (Join-Path $ProjectRoot 'harness-adapter') | Out-Null
```

프로젝트의 추적 대상인 `harness-adapter/project.json`에 다음처럼 선언합니다. `paths`는 프로젝트 코드 경로가 아니라 **Harness 설치 아래**의 관리 경로입니다. 세 경로는 서로 겹치면 안 됩니다.

```json
{
  "schemaVersion": 1,
  "id": "my-project",
  "displayName": "My Project",
  "paths": {
    "tasks": "projects/my-project/tasks",
    "memory": "projects/my-project/memory",
    "runtime": "projects/my-project/runtime"
  },
  "adapters": {}
}
```

위 예시를 다음 명령으로 저장합니다. 다른 ID를 선택했다면 위 JSON과 `$ProjectId`의 모든 `my-project` 값을 동일하게 바꾸세요.

```powershell
$Manifest = Join-Path $ProjectRoot 'harness-adapter/project.json'
if (Test-Path -LiteralPath $Manifest) { throw '프로젝트 manifest가 이미 있습니다. 기존 파일을 보존하고 내용을 검토하세요.' }
@{
  schemaVersion = 1
  id = $ProjectId
  displayName = 'My Project'
  paths = @{
    tasks = "projects/$ProjectId/tasks"
    memory = "projects/$ProjectId/memory"
    runtime = "projects/$ProjectId/runtime"
  }
  adapters = @{}
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM $Manifest
git -C $ProjectRoot add harness-adapter/project.json
if ($LASTEXITCODE -ne 0) { throw '프로젝트 manifest Git 추가 실패' }
```

설치 쪽의 `harness-adapter/binding.local.json`은 로컬 전용이며 이 저장소의 `.gitignore`에 포함됩니다. 프로젝트 ID와 절대경로를 실제 값으로 바꾸세요. Windows 경로를 JSON에 직접 입력할 때는 역슬래시를 `\\`로 이스케이프해야 합니다. 다음 PowerShell 코드는 이를 자동 처리합니다.

```powershell
Set-Location $HarnessRoot
New-Item -ItemType Directory -Path (Join-Path $HarnessRoot 'harness-adapter') -Force | Out-Null
$Binding = Join-Path $HarnessRoot 'harness-adapter/binding.local.json'
if (Test-Path -LiteralPath $Binding) { throw '로컬 binding이 이미 있습니다. 덮어쓰지 말고 기존 등록을 검토하세요.' }
@{
  schemaVersion = 1
  registrations = @(@{
    projectId = $ProjectId
    harnessRoot = $HarnessRoot
    projectRoot = $ProjectRoot
  })
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM $Binding
```

이후 **Harness 설치 디렉터리**에서 다음 순서로 실행합니다. 모든 명령에 같은 명시적 프로젝트 맥락을 전달하며, 진단은 읽기 전용입니다.

```powershell
npm test
if ($LASTEXITCODE -ne 0) { throw '엔진 테스트 실패: init 중단' }
npm run self-check
if ($LASTEXITCODE -ne 0) { throw '엔진 자체 점검 실패: init 중단' }
node scripts/project-diagnostic.mjs --checkout $ProjectRoot --binding $Binding --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw '프로젝트 binding 진단 실패: init 중단' }
npm run init -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
if ($LASTEXITCODE -ne 0) { throw '프로젝트 runtime 초기화 실패' }
npm run status -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
if ($LASTEXITCODE -ne 0) { throw '프로젝트 상태 조회 실패' }
npm run preview:live -- --project $ProjectId --checkout $ProjectRoot --binding $Binding
```

진단 성공 시 `OK: Project context is valid`가 출력됩니다. `init`은 선언한 `projects/my-project/runtime`에 상태 파일을 만들고, `status`는 `Pure Harness`, `Goal none`, `Phase idle`을 표시합니다. `preview:live`가 출력한 localhost URL에 `#guide`를 붙여 가이드를 여세요. 프로젝트 checkout을 Codex에서 별도로 열고, 필요한 에이전트·Skill·훅이 그 환경에서 실제 탐색되는지도 확인해야 합니다. 네 도구용 생성 역할의 native smoke는 아직 미검증이며 이 절차는 자동 배포나 프로젝트 전환을 완료하지 않습니다.

진단이 실패하면 `init`을 실행하지 마세요. `MISSING_FILE`은 manifest 또는 binding 위치, `INVALID_GIT`은 기본 Git checkout 여부, `NESTED_ROOT`는 두 디렉터리의 분리, `MISMATCHED_ID`는 세 위치의 프로젝트 ID, `PATH_ESCAPE`는 관리 경로가 `projects/<id>/` 아래인지 확인하세요. `--checkout`에는 원본 프로젝트 root 또는 그 프로젝트의 **실제 Git worktree**만 사용합니다. `status`도 누락된 runtime 파일을 만들 수 있으므로 진단보다 앞서 실행하지 마세요. 기존 runtime·작업 명세·메모리·점유·열린 세션을 삭제하거나 초기화하지 마세요.

이 단계적 중립 엔진의 `init`, `status`, `watchdog`, `preview`, `preview:live` 스크립트는 모두 `--project`, `--checkout`, `--binding`을 요구합니다. `watchdog`는 경고와 이벤트를 기록합니다. 기존 설치나 다른 checkout의 명령 동작까지 이 설명으로 일반화하지 마세요.

```powershell
npm run status -- --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로>
npm run watchdog -- --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로>
npm run preview:live -- --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로>
```

`preview:live`는 선택 프로젝트 runtime을 초기화하고 localhost 서버를 시작합니다. 실시간 대시보드는 실행 중 3초마다 갱신됩니다. 가이드의 실제 HTML은 [`preview/index.html`](preview/index.html)에 있으며 서버가 출력한 URL에 `#guide`를 붙여 엽니다(예: `http://127.0.0.1:8765/#guide`). 이 HTML은 `/runtime/*` API와 `/preview/*` 자산을 요청하므로 `file://` 직접 열기는 지원되는 가이드 열람 경로가 아닙니다. `npm run preview -- --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로>`는 선택 프로젝트 runtime에 `preview.html` 정적 스냅샷을 한 번 쓰고 종료합니다. 스냅샷은 생성 뒤 갱신되지 않습니다.

Preview Lab은 읽기 전용입니다. 선택 프로젝트의 관리 경로에서 Planner 작업 명세와 등록된 UI 아티팩트를 보여줍니다. 여러 아티팩트는 탭으로 표시하여 동일 앱의 route, hash, query-string 변형을 따로 검토할 수 있습니다. 목표나 작업 명세를 바꾸려면 Codex에 요청하세요. 대시보드에서 runtime 상태를 직접 수정하지 마세요.

### 에이전트 신호 네트워크

**실행 중 기록 에이전트**는 runtime에 실행 중이라고 기록된 항목이지 실제 생존 여부를 확인한 목록이 아닙니다. **에이전트 신호 네트워크**는 기록된 관계와 흐름을, **신호 타임라인**은 최신 저장 신호 10개를 최근 순으로, **Preview Lab**은 결과 UI와 아티팩트를 보여줍니다. 대시보드에서 에이전트나 신호를 선택해 상세 정보를 보고, 실행 중 기록만/전체 기록, 전체/실행 중 기록/실패/현재 작업 필터, 작업 선택, 드래그 이동, 휠·버튼 확대/축소, 맞춤/초기화를 사용할 수 있습니다. 실패와 재시도 신호는 다르게 표시됩니다. 그래프는 실제 기록된 신호만 사용하며 작업 소유권, 점유, 시각만으로 인계를 추론하지 않습니다. 저장 신호가 없으면 추론한 edge도 없습니다.

```powershell
# 실제 선택 프로젝트: 서버가 출력한 URL을 엽니다.
npm run preview:live -- --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로>

# 격리된 결정론적 네트워크 데모: 출력된 URL을 엽니다.
npm run demo:network

# 데모 서버를 중지한 뒤 데모 데이터만 제거합니다.
npm run demo:reset
```

데모는 `.ai/demo/network-runtime`의 fixture 데이터를 사용합니다. `demo:network`는 그 데모 디렉터리를 새 fixture로 준비하며 기존 데모 데이터를 교체하고, `demo:reset`은 정확히 그 디렉터리만 제거합니다. 실제 선택 프로젝트 runtime은 제거하지 않습니다. 데모 대시보드에서 node·edge 선택, 실행 중 기록만/전체 기록과 작업·실패 필터, 실행 중 기록 에이전트와 신호 타임라인을 확인할 수 있습니다. 정적 스냅샷의 네트워크는 **Snapshot History**로 표시되고 저장 시점 데이터에만 필터를 적용하며 polling하지 않습니다.

### 단계적 로컬 설치

기존 프로젝트 runtime의 복사본이 아닌 깨끗한 중립 엔진 export에서 별도 설치를 시작합니다. 프로젝트 manifest에 작업 명세, 메모리, runtime 관리 경로를 선언하고 로컬 checkout/binding 경로는 무시되는 설정에 둡니다. 엔진 export에는 엔진 개발용 작업 명세와 메모리가 포함되지 않습니다. Node가 없는 이식형 소비 환경에서는 소스 checkout의 `.ai/`를 기본 위치로 가정하지 말고 선언된 관리 경로를 사용합니다.

기존 프로젝트 runtime, 작업 명세, 메모리, 점유, 열린 세션을 보존하세요. 설치하면서 초기화·이관하지 마세요. 이관에는 중단 상태, 백업, 검증, 롤백 근거를 갖춘 별도 검토가 필요합니다. 선택 프로젝트 맥락을 검증하지 못했다면 기본 프로젝트를 추측하지 말고 상태 변경 명령을 중단합니다. Node 기반 단계적 설치에서는 명시적 인자로 `scripts/project-diagnostic.mjs`를 실행하고, 단계적 엔진에서 `npm test`와 `npm run self-check`를 실행한 뒤 새 선택 프로젝트 세션에서 네이티브 탐색을 확인합니다. 프로젝트 전환 게이트는 현재 의도적으로 닫혀 있습니다. 테스트 성공만으로 실제 전환이 허용되지는 않습니다. [프로젝트 분리 전환 게이트](docs/project-isolation-cutover.md)를 참조하세요.

## 네 도구용 역할 생성기: 현재 단계와 제한

제품에 종속되지 않는 정본 역할은 `harness/agents/<id>.md`에 있습니다. Node 스크립트는 Codex, Claude Code, OpenCode, Antigravity용 후보 역할 파일을 생성합니다. 생성된 역할의 소비에는 Node나 생성기 스크립트가 필요하지 않습니다. 정본 Skill은 `.agents/skills/`에 있습니다. 이 checkout에는 정본 역할 15개가 있지만 기존 Codex 설정에는 수동 관리 역할 14개만 등록되어 있습니다. 기존 설정, 훅, 루트 지침, Skill은 이 단계에서 생성·채택되지 않았고 생성 manifest나 승인된 채택 기록도 없습니다.

현재 `harness/compatibility.json`에서 네 대상 모두 `nativeSmoke: unverified`입니다. 따라서 후보 문법과 유효 권한·네이티브 로딩을 검증했다고 볼 수 없으며 일반 `sync` 쓰기 경로는 네이티브 스모크 게이트로 차단됩니다. Codex Skill 경로에는 고정 CLI 문서 근거가 있지만 역할 호출과 유효 권한의 네이티브 스모크는 없습니다. 다른 세 대상의 Skill 탐색도 생성기가 네이티브 준비 상태로 인정하지 않습니다. 네 도구를 모두 사용할 수 있는 배포물이라고 설명하거나 실제 checkout에 후보 파일을 적용하지 마세요. [네 도구 네이티브 스모크 절차](docs/native-smoke-worksheet.md)와 [생성기 상세 설명](docs/cross-tool-generator.md)을 참조하세요.

다음은 읽기 전용 탐색·검사 명령입니다. `--targets`는 `codex`, `claude`, `opencode`, `antigravity`, 쉼표로 구분한 부분집합 또는 `all`을 받고, `--profile`은 `core` 또는 `all`입니다. `--root <경로>`를 생략하면 현재 작업 디렉터리를 사용합니다.

```powershell
node scripts/detect-targets.mjs --json
node scripts/validate.mjs --targets codex --profile core --json
node scripts/sync.mjs --targets codex --profile core --dry-run
node scripts/sync.mjs --targets codex --profile core --check
```

이 checkout에서 `validate`는 생성 manifest 누락과 미확인 네이티브 스모크를 보고합니다. `sync --dry-run`은 수동 관리 Codex 경로와 충돌을 보여 주고, `sync --check`는 출력이 소유·최신 상태가 아니므로 실패할 수 있습니다. 이는 실제 게이트를 보여 주는 결과이지 테스트 모음 실패가 아닙니다. 일반 쓰기 명령 `node scripts/sync.mjs --targets <대상> --profile <core|all>`은 적절한 네이티브 스모크·Skill 탐색 증거, 소유권 조건과 별도 승인·검토가 준비된 경우에만 실행하세요. 현재는 실행하지 마세요. `--dry-run`과 `--check`는 함께 사용할 수 없습니다.

## 런타임

훅은 세션과 하위 에이전트 생명주기 메타데이터를 자동으로 기록하는 기본 결정론적 근거입니다. 훅 설정이 설치되었다고 현재 호스트에서 실제 발송되었다는 뜻은 아닙니다. `npm run self-check`는 발송을 **관찰됨**, **아직 관찰되지 않음**, **사용 불가 의심**으로 보고합니다. `SessionStart` 기록이 없다는 사실만으로 사용 불가를 판정하지 않습니다. 대응하는 하위 에이전트 훅 기록 없이 조율 fallback의 적극적인 근거가 있을 때만 의심 경고가 나옵니다. `watchdog`는 같은 근거 기반 경고를 대시보드에 기록합니다.

Main은 실제 네이티브 하위 에이전트 호출 전후에만 얇은 fallback을 사용합니다. 성공한 spawn 응답 뒤 정확한 네이티브 인스턴스 ID를 `--source orchestration`으로 기록하고, 결과가 돌아온 뒤 중립 종료와 점유 해제를 기록합니다. 계획만 세운 위임은 기록하지 않습니다. 결과가 돌아오지 않은 중단 에이전트는 stale 감지가 경고할 때까지 활성 기록으로 남습니다. 훅과 fallback은 정확히 같은 ID로만 조정하고 훅 근거를 우선합니다. 이름, 작업 텍스트, 시각만으로 서로 다른 기록을 합치지 않습니다. 하위 에이전트 종료 자체는 성공 판정이 아닙니다. 작업 상태와 검증 근거가 완료를 결정합니다.

프로젝트 runtime 명령의 형태는 `node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> <명령> ...`입니다. 아래 예시는 검증된 binding을 전제로 실제 상태를 변경합니다.

```powershell
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> goal "커넥터 구현" --phase execution
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> task implementation "커넥터 구현" in_progress --owner worker-1
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> claim worker-1 src/backend/
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test 실패: passed 기록 중단" }
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> verify passed unit-tests --detail "npm test"
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> release-claim worker-1
node scripts/runtime-state.mjs --project <프로젝트-id> --checkout <checkout-절대경로> --binding <binding-절대경로> signal planner worker handoff "작업 명세 준비 완료"
```

Main의 조율 fallback은 실제 네이티브 경계에서만 사용합니다. 성공한 spawn 뒤 `agent-start <native-agent-id> worker --task "커넥터 구현" --task-id implementation --source orchestration`을 기록하고, 결과가 돌아오면 `agent-stop <native-agent-id> --outcome stopped --task-id implementation --source orchestration`과 `release-claim <native-agent-id>`를 기록합니다. 이 명령에도 위의 `--project`, `--checkout`, `--binding` 인자가 필요합니다.

점유는 정규화한 파일·디렉터리 접두사로 겹침을 판단합니다. `src/`와 `src/backend/`는 충돌하지만 `src/backend/`와 `src/frontend/`는 충돌하지 않습니다. 충돌하는 작성자는 순차 실행하거나 네이티브 Git worktree로 격리합니다.

`npm run watchdog -- --project ... --checkout ... --binding ...`는 일회성 결정론적 이상 탐지입니다. 오래된 에이전트, 소유자 없는 작업, 불완전·실패·차단된 검증, 겹치는 점유의 경고를 기록합니다. 복구는 Main Codex가 판단합니다. Supervisor는 상주 daemon이 아니라 요청 시 실행하는 읽기 전용 점검 역할입니다.

## 작업 흐름

- SMALL: Worker 한 명과 범위에 맞는 최소 검증.
- MEDIUM: 계획, 실행, 독립 검증, 가치가 있을 때 리뷰.
- LARGE: 필요에 따라 영향 분석, 격리된 작성자/worktree, 통합, Supervisor 점검 추가.

Worker는 구현과 테스트를 작성할 수 있습니다. Verifier는 읽기 전용으로 검사를 독립 재실행합니다. Reviewer는 정확성, 회귀, 범위, 근거를 평가합니다. Verifier와 Reviewer는 결과를 통과시키기 위해 테스트를 고치지 않습니다. 절차는 [테스트 Skill](.agents/skills/testing/SKILL.md)을 참조하세요.

## 모델 정책

Main Codex 모델과 추론 수준은 사용자가 선택하거나 현재 설정을 상속합니다. 하위 에이전트 기본값은 `.codex/config.toml`과 `.codex/agents/*.toml`의 역할별 설정이 기준입니다.

- Planner, Reviewer, Supervisor, Integrator, Security, Performance: Sol / High.
- Worker, Impact analysis: Sol / Medium.
- Verifier, Researcher, Environment, Release: Luna / Medium.
- Context curation, Preview: Luna / Low.

이 정책은 최적화일 뿐 Harness의 필수 조건은 아닙니다. 지원되는 경우 어려운 단일 작업에 한해 spawn 시 상향할 수 있지만 충분히 믿을 만한 가장 경제적인 모델·추론 수준을 기본으로 사용합니다. Astra는 예외적인 수동 상향 전용이며 기본값이 아닙니다. 저장소 자체 점검은 계정의 모델 사용 권한을 검증하지 않습니다.

### 모델 호환성 대체

v1.1.1 설정은 역할별 GPT-6 Sol/Luna 기본값을 명시합니다. 지원되는 네이티브 spawn 시도에서 선호 GPT-6 모델이 사용 불가, 비활성, 미지원, 권한 없음 또는 workspace에 미노출이라는 명시적 오류가 발생한 경우에만 Main은 같은 역할의 GPT-5.6 Sol/Luna 모델과 같은 추론 수준으로 한 번 재시도할 수 있습니다. 일반 구현, 테스트, 도구, timeout, 작업 실패는 이 경로를 사용하지 않습니다. [모델 라우팅 Skill](.agents/skills/model-routing/SKILL.md)을 참조하세요.

Pure Harness에는 Codex 네이티브 spawn 오류를 가로채는 daemon이나 스크립트가 없습니다. 설정된 역할 모델을 사용할 수 없다면 해당 역할의 모델 override를 수동 제거하여 활성 Main 모델을 상속할 수도 있습니다. 이 이식형 대체 방식은 엄격한 모델 정책 검증 범위 밖이므로 표준 역할 설정을 복구할 때까지 자체 점검이 실패할 수 있습니다.

## 구성

- `.codex/agents/`, `.codex/config.toml`: 기존 Codex 에이전트 카탈로그의 기준 설정.
- `.agents/skills/`: `SKILL.md` frontmatter로 탐색하는 저장소 Skill.
- `harness/agents/`, `harness/targets/`, `scripts/detect-targets.mjs`, `scripts/validate.mjs`, `scripts/sync.mjs`: 중립 역할 정본과 네 도구용 단계적 생성기.
- `projects/`: 중립 프로젝트 schema와 예시. 생성 상태는 선택 프로젝트의 선언된 설치 runtime 경로가 소유합니다.
- `scripts/`: Node 내장 모듈 기반 CLI, 훅 연결, watchdog, 미리보기, 자체 점검.
- `preview/`: 선택적 실시간 대시보드와 UI 제안.

별도 패키지 설치는 필요하지 않습니다. Node.js 20+, Git, 프로젝트 에이전트와 훅을 지원하는 Codex 버전을 사용합니다.
