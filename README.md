# Pure Harness v1.1.1

Pure Harness는 Codex 기본 기능을 활용하는 가벼운 작업 흐름 도구입니다. Main Codex가 작업 조율을 판단하고, Skill이 반복 가능한 절차를 제공하며, 독립적인 맥락이나 판단이 필요할 때만 전문 에이전트를 사용합니다. 결정론적인 상태 기록과 점검은 스크립트와 hook이 담당합니다.

가벼운 스크립트와 hook에는 Node.js를 사용합니다. 평소 사용에 상주 Node 서버는 **필요하지 않습니다**. 서버는 선택 사항인 실시간 대시보드를 사용할 때만 필요합니다.

## 시작하기

1. 버전 관리되는 Pure Harness 파일을 Git 저장소에 복제하거나 복사합니다.
2. `npm run init`을 실행합니다.
3. Codex에서 저장소를 열고 `/hooks`로 hook을 검토한 뒤 신뢰할 수 있는지 확인합니다.
4. `npm run self-check`를 실행합니다.
5. 평소처럼 Codex를 사용합니다. 터미널에서 현재 상태를 확인하려면 `npm run status`를 실행합니다.

```powershell
npm run init
npm run status
npm run preview
npm run preview:live
npm run watchdog
npm test
npm run self-check
```

`npm run preview`는 현재 runtime의 단일 스냅샷을 `.ai/runtime/preview.html`로 만들고 종료합니다. `npm run preview:live`는 선택 사항인 대시보드를 기본 포트 `8765`의 `http://127.0.0.1:8765/`에서 시작합니다. 이 서버는 localhost에서만 접근할 수 있고 3초마다 runtime 상태를 새로 읽습니다. 실시간 Harness 가이드는 서버 실행 중 [Guide](http://127.0.0.1:8765/#guide)에서 볼 수 있습니다. `PURE_HARNESS_PORT`를 설정했다면 서버가 출력한 URL 뒤에 `#guide`를 붙여 여세요. `preview/index.html`은 서버가 제공하는 대시보드 셸이며, `file://`로 직접 열어 사용하는 독립형 Guide 파일이 아닙니다.

Preview Lab은 읽기 전용입니다. `.ai/tasks/*.md`에서 발견한 Planner의 Task Spec과 등록된 UI 아티팩트를 보여줍니다. 아티팩트가 여러 개면 탭으로 표시하고 선택한 항목을 크게 미리 보여주므로, 한 앱의 경로·상태·hash·query string 변형을 따로 검토할 수 있습니다. 목표나 Task Spec을 바꾸려면 Codex에 요청하세요. 대시보드에서 runtime 상태를 직접 수정하지 마세요.

### Agent Signal Network

네 화면은 각각 다른 질문에 답합니다. **Active Agents**는 현재 실행 중인 에이전트를, **Agent Signal Network**는 기록된 관계와 작업 흐름을, **Signal Timeline**은 최근 저장 신호 10개를 최신순으로, **Preview Lab**은 결과 UI와 등록된 아티팩트를 보여줍니다. 실시간 대시보드에서 에이전트나 신호를 선택하면 세부 정보를 볼 수 있습니다. Live/History, All/Active/Failures/Current Task 필터, 작업 선택, 드래그 이동, 휠 또는 버튼 확대·축소, Fit/Reset으로 네트워크를 탐색합니다. 실패와 재시도 신호는 서로 다른 모양으로 표시됩니다. 그래프에는 실제 기록된 신호만 사용하며 작업 소유자·점유·시간을 근거로 인계 관계를 추론하지 않습니다. 기록된 신호가 없으면 추론된 연결선도 없습니다.

```powershell
# 실제 프로젝트 runtime: 서버가 출력한 URL을 엽니다
npm run preview:live

# 격리된 결정론적 네트워크 데모: 출력된 URL을 엽니다
npm run demo:network

# 데모 서버를 중지한 뒤 실행합니다
npm run demo:reset
```

데모는 `.ai/runtime`이 아닌 `.ai/demo/network-runtime`의 fixture 데이터를 읽습니다. `npm run demo:reset`은 정확히 `.ai/demo/network-runtime`만 제거하고 실제 runtime 상태는 지우지 않습니다. 데모 대시보드에서 노드와 연결선을 선택하고, Live/History를 바꾸고, 작업·실패 필터를 적용한 뒤 Active Agents와 Signal Timeline을 살펴보세요. `npm run preview`는 **Snapshot History**로 표시되는 대화형 네트워크를 정적 HTML 스냅샷에 저장합니다. 이 파일의 필터는 저장 당시 스냅샷을 기준으로 동작하며 생성 후에는 새로 읽거나 갱신하지 않습니다. 실시간 대시보드는 서버가 실행되는 동안 3초마다 갱신됩니다.

### 새 프로젝트 설정 / Pure Harness 복사

Pure Harness 폴더를 완전히 새로운 프로젝트로 복사하면 프로젝트별 상태와 Pure Harness 개발 기록도 따라올 수 있습니다. `.ai/runtime`에는 원본 프로젝트의 목표·작업·이벤트·에이전트·쓰기 점유가 남아 있을 수 있습니다. `npm run init`은 누락된 runtime 파일을 만들고 필드를 채우지만 복사된 기존 runtime을 완전히 비우지 않습니다. 따라서 **새로 복사한 프로젝트에서만** 해당 디렉터리를 먼저 제거합니다. 원본이나 계속 사용 중인 기존 프로젝트에는 아래 삭제 명령을 실행하지 마세요.

Codex 세션이 열린 상태에서 `.ai/runtime`을 초기화하면 기록된 `SessionStart` 이력이 제거되고, 해당 hook은 다음 세션이 열릴 때까지 다시 실행되지 않을 수 있습니다. 이는 새 runtime에 그 세션의 생명주기가 관측되지 않았다는 뜻일 뿐입니다. Pure Harness는 이를 대신할 이벤트를 만들어 내거나 이 누락만으로 Harness 고장이라고 판단하지 않습니다.

Windows PowerShell에서 새 프로젝트의 루트로 이동한 뒤 다음 순서를 따르세요. 먼저 `Get-Location`으로 현재 위치를 확인하고, 삭제 대상이 새 프로젝트 안에 있는지 직접 확인하세요.

```powershell
# 1. 현재 위치와 삭제 대상을 확인합니다. 반드시 새 프로젝트 루트여야 합니다.
Get-Location
Get-Item -LiteralPath .ai\runtime -ErrorAction SilentlyContinue

# 2. 새 프로젝트로 복사된 프로젝트별 runtime 상태만 초기화합니다.
Remove-Item -LiteralPath .ai\runtime -Recurse -Force
npm run init

# 3. 복사된 Task Spec 후보의 전체 경로를 읽기 전용으로 나열합니다.
Get-ChildItem -LiteralPath .ai\tasks -Filter '*.md' -File |
Where-Object { $_.Name -ne 'README.md' } |
Select-Object -ExpandProperty FullName

# 4. 복사된 Harness를 검증합니다.
npm run self-check
npm test

# 5. 실시간 대시보드를 시작합니다.
npm run preview:live
```

`.ai/tasks/*.md`에는 Pure Harness 자체를 개발하는 데 사용한 Task Spec이 포함될 수 있고, 복사된 명세는 Preview Lab에도 나타납니다. 위 목록은 삭제 대상이 아닌 검토 후보입니다. 새 프로젝트에서 원본 Pure Harness의 개발용 명세라고 확인한 파일만 하나씩 전체 경로를 직접 지정해 `Remove-Item -LiteralPath '확인한-파일-전체-경로' -Force`로 제거하세요. `README.md`와 새 프로젝트의 명세는 보존하세요. 기존 프로젝트를 이어서 사용하거나 Task Spec을 보존해야 한다면 삭제하지 마세요.

`.ai/memory`에 원본 프로젝트 정보가 있는지 검토하되 디렉터리 전체를 자동으로 삭제하지 마세요. 유지해야 할 프로젝트 지식이 담겨 있을 수 있습니다. `.git`까지 복사했다면 `git remote -v`로 대상 프로젝트가 원본 Pure Harness remote에 계속 연결되어 있지 않은지 확인하세요.

## Runtime

Hook은 세션과 하위 에이전트의 생명주기 메타데이터를 자동으로 기록하며, 결정론적 기록의 기본 출처입니다. Hook 설정이 설치되어 있어도 현재 호스트에서 실제로 실행되었다는 뜻은 아닙니다. `npm run self-check`는 실행 증거를 **observed(관측됨)**, **not yet observed(아직 관측되지 않음)**, **suspected unavailable(사용 불가 의심)**로 보고합니다. 사용 불가 의심 경고에는 대응하는 하위 에이전트 hook 증거가 없는 상태에서 조율 fallback의 긍정적 증거가 있어야 합니다. `SessionStart`가 없는 것만으로는 충분하지 않습니다. `npm run watchdog`도 동일한 증거 기반 fallback 경고를 대시보드에 저장합니다.

Main은 실제 native 하위 에이전트 호출 전후에만 가벼운 fallback을 사용합니다. 성공적인 spawn 확인을 받은 뒤 정확한 native 에이전트 인스턴스 ID를 `--source orchestration`과 함께 기록하고, 실제 결과가 돌아오면 중립적인 종료를 기록한 뒤 점유를 해제합니다. 계획만 세운 위임은 fallback 기록을 만들지 않습니다. 결과가 돌아오지 않은 중단된 에이전트는 오래된 실행으로 감지되어 경고가 나올 때까지 활성 상태로 남습니다. Hook과 fallback 기록은 정확한 ID로 조정하며 hook 출처가 우선합니다. Pure Harness는 이름이 다른 기록을 같은 에이전트라고 추측하지 않습니다.

하위 에이전트의 종료는 성공 판정이 아닌 중립적 사건입니다. 완료 여부는 작업 상태와 검증 증거로 판단합니다.

```powershell
node scripts/runtime-state.mjs goal "Implement connector" --phase execution
node scripts/runtime-state.mjs task implementation "Implement connector" in_progress --owner worker-1
node scripts/runtime-state.mjs claim worker-1 src/backend/
node scripts/runtime-state.mjs verify passed unit-tests --detail "npm test"
node scripts/runtime-state.mjs release-claim worker-1
node scripts/runtime-state.mjs signal planner worker handoff "Task spec ready"

# Main 조율 fallback 예시: 실제 native 호출 경계에서만 사용합니다.
node scripts/runtime-state.mjs agent-start <native-agent-id> worker --task "Implement connector" --task-id implementation --source orchestration
node scripts/runtime-state.mjs agent-stop <native-agent-id> --outcome stopped --task-id implementation --source orchestration
node scripts/runtime-state.mjs release-claim <native-agent-id>
```

점유는 정규화된 파일/디렉터리 접두 경로를 사용합니다. `src/`와 `src/backend/`는 충돌하지만 `src/backend/`와 `src/frontend/`는 충돌하지 않습니다. 충돌하는 작성자는 순서대로 작업하거나 native Git worktree로 격리합니다.

`npm run watchdog`는 한 번 실행되는 결정론적 이상 상태 점검입니다. 오래된 에이전트, 소유자 없는 작업, 미완료 검증, 실패·차단된 검증, 겹치는 점유를 경고로 기록합니다. 복구는 Main Codex가 판단하며 Supervisor는 상주 프로세스가 아니라 요청 시에만 실행하는 읽기 전용 감사 역할입니다.

## 작업 흐름

- SMALL: Worker 한 명과 작업에 비례하는 최소 검증.
- MEDIUM: 계획, 실행, 독립 검증을 거치고 가치가 있을 때 리뷰.
- LARGE: 필요에 따라 영향 분석, 격리된 작성자/worktree, 통합, Supervisor 점검을 추가.

Worker는 구현과 테스트를 작성할 수 있습니다. Verifier는 검증 명령을 독립적으로 읽기 전용 재실행합니다. Reviewer는 정확성, 회귀, 범위, 증거를 평가합니다. Verifier와 Reviewer는 결과를 통과시키기 위해 테스트를 수정하지 않습니다. 반복 가능한 검증 절차는 `.agents/skills/testing/SKILL.md`를 참고하세요.

## 모델 정책

Main Codex는 사용자가 선택했거나 상속한 모델을 그대로 사용합니다. 하위 에이전트 기본값은 `.codex/config.toml`에, 역할별 재정의는 `.codex/agents/*.toml`에 있으며 이 파일들이 기준입니다.

- Planner, Reviewer, Supervisor, Integrator, Security, Performance: Sol / High.
- Worker, Impact Analysis: Sol / Medium.
- Verifier, Researcher, Environment, Release: Luna / Medium.
- Context Curation, Preview: Luna / Low.

Main Codex의 모델과 추론 수준은 사용자가 선택했거나 상속한 값을 유지합니다. 하위 에이전트는 `.codex/config.toml`과 `.codex/agents/`에 명시된 역할별 기본 모델과 추론 수준을 사용합니다.

이 정책은 비용·성능 최적화이지 Harness 동작의 필수 조건은 아닙니다. 지원되는 경우 어려운 단일 작업에 한해 spawn 시 재정의로 모델을 올릴 수 있지만 기본적으로는 신뢰할 수 있는 가장 저렴한 모델과 추론 수준을 사용합니다. Astra는 수동 예외적 상향에만 쓰며 기본값으로 지정하지 않습니다. 저장소 self-check는 모델 사용 권한을 검증하지 않습니다.

### 모델 호환성 fallback

검증된 v1.1.1 설정은 역할별 GPT-6 Sol/Luna 기본값을 명시합니다. 지원되는 native spawn 시 재정의에서 선호하는 GPT-6 모델이 사용 불가, 비활성화, 미지원, 권한 없음, 또는 workspace에 노출되지 않았다는 오류가 발생하면 Main은 동일한 역할과 추론 수준을 유지하면서 대응하는 GPT-5.6 Sol/Luna 모델로 한 번 재시도할 수 있습니다. 일반적인 구현·테스트·도구·시간 초과·작업 실패는 이 경로를 사용하지 않습니다. 반복 가능한 절차는 `.agents/skills/model-routing/SKILL.md`에 있습니다.

Pure Harness에는 Codex native spawn 오류를 가로채는 daemon이나 스크립트가 없습니다. 설정된 역할 모델을 사용할 수 없다면 영향을 받는 모델 재정의를 수동으로 제거하고 활성 Main Codex 모델을 상속할 수도 있습니다. 이 이식성 fallback은 엄격한 모델 정책 검증 범위 밖이므로 표준 역할 설정을 복원하기 전까지 self-check가 실패할 수 있습니다.

## 구조

- `.codex/agents/`와 `.codex/config.toml`: 에이전트 카탈로그의 기준.
- `.agents/skills/`: `SKILL.md` frontmatter에서 검색하는 저장소 Skill.
- `.ai/runtime/`: Git에서 제외되는 생성 목표·작업·이벤트·점유 상태.
- `scripts/`: 외부 의존성 없이 Node 내장 기능만 사용하는 CLI, hook bridge, watchdog, preview, self-check.
- `preview/`: 선택 사항인 실시간 대시보드와 UI 제안.

패키지 설치는 필요하지 않습니다. Node.js 20 이상, Git, 프로젝트 에이전트와 hook을 지원하는 Codex 버전을 사용하세요.
