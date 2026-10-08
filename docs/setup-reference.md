# Pure Harness 설정·운영 참고

[처음 사용 가이드](first-use.md)는 새 프로젝트와 기존 프로젝트의 짧은 시작 절차입니다. 이 문서는 설정 계획, 보존 경계와 운영 명령을 자세히 설명합니다. Windows PowerShell 7, Node.js 20+, Git을 기준으로 합니다.

## 설치 구조

Harness 저장소 하나가 고정된 `project/` 하나를 소유합니다. 그 자식 폴더에는 별도 `.git`이 있고, 제품 코드와 Git 기록이 들어갑니다. Harness의 `.harness/`에는 무시되는 설치 설정, 역할 어댑터 소유권·백업, 작업 명세·메모리·runtime이 들어갑니다. 엔진 Git과 제품 Git은 서로 독립적입니다. 여러 프로젝트 등록이나 외부 checkout 선택은 이 설치 모델에 없습니다.

`project/` 또는 `.harness/`에 기존 데이터가 있으면 먼저 계획의 충돌을 확인하세요. 다른 제품을 같은 설치에 덮어쓰지 않습니다. 원본 저장소와 기존 runtime·작업 명세·메모리·점유·세션을 삭제하거나 초기화하지 마세요.

## 대화형 설정

Harness 저장소를 별도 경로에 clone하거나 준비된 설치로 이동합니다. 예시 경로는 자신의 경로로 바꿉니다.

```powershell
Set-Location C:\tools\pure-harness
npm run setup
```

설정은 새 프로젝트/기존 프로젝트, 기존 프로젝트라면 원본 경로 또는 Git 원격, 그리고 AI 도구(Codex, Claude Code, OpenCode, Antigravity)를 묻습니다. 기본 도구는 Codex입니다. 읽기 전용 계획을 먼저 보여 주며, 파일 변경·충돌·백업·검증 한계를 확인한 뒤 `apply <계획 해시 앞 12자리>`를 정확히 입력해야 적용합니다. 일반 실행에 프로젝트 ID, checkout, binding 인자는 없습니다.

새 프로젝트는 비어 있거나 아직 없는 `project/`에 독립 Git 저장소를 만듭니다. 기존 로컬 프로젝트는 원본을 변경하지 않고 Git 기록, 커밋되지 않은 변경, 추적되지 않은 파일과 무시된 파일을 계획에 따라 복사합니다. 원격 프로젝트는 계획 시 HEAD만 고정하고 파일 목록·파일별 충돌은 확인할 수 없습니다. 복제 후 새 충돌이 드러나면 `project/` 게시 전에 중단하며, 검토 가능한 로컬 checkout에서 새 계획을 만들어야 합니다. 원본 파일은 이동되지 않습니다. 연결된 worktree, 목적지 충돌, 변경된 계획 또는 원본은 조용히 덮어쓰지 않고 중단합니다.

이미 설정된 설치에서 다른 도구를 선택하면 같은 `project/`의 업데이트 계획이 됩니다. 이전 도구의 파일을 몰래 삭제하지 않습니다. 충돌·사용자 수정 파일은 자동 덮어쓰지 않고 검토가 필요합니다.

자동화가 필요한 경우에는 읽기 전용 `--mode new|existing --source <절대경로 또는 원격> --target <도구> --plan`으로 JSON 계획을 만들고, 검토한 계획 파일에 한해서 `--apply <계획 파일>`을 사용할 수 있습니다. 새 프로젝트의 `--source`는 생략합니다. `--apply`와 모드·원본 선택 플래그를 섞지 마세요. 계획만 작성하는 동작은 설치 파일을 쓰지 않습니다. 운영 자동화에서도 해시와 현재 파일 상태 검증을 건너뛸 수 없습니다.

## 일상 명령

설정 적용 후 Harness 폴더에서 실행합니다. `init`은 처음 한 번만 실행하고, 이미 있는 runtime을 강제 초기화하지 마세요.

```powershell
npm run init
npm run status
npm run preview:live
```

`preview:live`가 실제로 출력한 localhost URL에 `#guide`를 붙여 여세요. 서버는 `Ctrl+C`로 종료합니다. live 가이드 소스는 [preview/index.html](../preview/index.html)이며 이를 `file://`로 직접 열기는 지원되는 가이드 열람 경로가 아닙니다. 별도 [오프라인 갤러리](../offline-gallery/index.html)는 `file://`로 열 수 있고, 내장 예시가 차단되면 [독립 예시](../offline-gallery/tasks/example.html)를 따로 엽니다. 갤러리는 live runtime 대시보드가 아닙니다. `npm run preview`는 정적 스냅샷을 한 번 저장하고 갱신하지 않습니다. `npm run watchdog`는 결정론적 이상 경고와 이벤트를 기록합니다.

Preview Lab은 기록된 작업 명세와 등록된 UI 아티팩트를 읽기 전용으로 보여 줍니다. 대시보드 기록은 실제 에이전트 생존이나 작업 완료를 자동으로 증명하지 않습니다. 작업 상태 변경은 검증된 근거에 따라 엔진 명령으로 수행하세요. 같은 checkout의 겹치는 파일 점유는 순차 처리하거나 별도 worktree로 격리합니다.

### 에이전트 신호 네트워크

**실행 중 기록 에이전트**는 runtime에 실행 중으로 표시된 항목이지 실제 생존을 확인한 목록이 아닙니다. 네트워크는 저장된 관계와 흐름만 사용하고, 신호 타임라인은 최신 저장 신호를 표시합니다. 신호가 없으면 작업 소유권·점유·시각만으로 연결선을 추측하지 않습니다. 에이전트와 신호를 선택해 상세 기록을 확인할 수 있고 필터·이동·확대·맞춤·초기화는 저장된 스냅샷에 적용됩니다.

`npm run demo:network`는 격리된 데모 fixture를 보여 주며, 종료 후 `npm run demo:reset`은 데모 데이터만 제거합니다. 실제 프로젝트 runtime과 혼동하지 마세요. 정적 `npm run preview` 결과는 저장 시점의 Snapshot History이며 polling하지 않습니다.

### 작업 흐름과 검증

- SMALL: 범위가 정해진 Worker 작업과 비례하는 검사.
- MEDIUM: 계획·구현·독립 검증, 가치가 있을 때 리뷰.
- LARGE: 영향 분석, 분리된 writer, 통합과 감독 점검을 필요에 따라 추가.

Worker는 구현과 테스트를 담당할 수 있습니다. Verifier는 독립적으로 검사를 재실행하고, Reviewer는 정확성·회귀·범위·근거를 평가합니다. 하위 에이전트 종료 자체는 성공 판정이 아닙니다. 검증 근거와 실제 산출물을 확인하세요. [테스트 Skill](../.agents/skills/testing/SKILL.md)에 비례하는 검증 기준이 있습니다.

점유는 정규화한 파일·디렉터리 접두사로 겹침을 판단합니다. `src/`와 `src/backend/`는 충돌하지만 `src/backend/`와 `src/frontend/`는 충돌하지 않습니다. 겹치는 작성자는 순차 실행하거나 별도 worktree로 격리합니다. Watchdog는 오래된 에이전트, 소유자 없는 작업, 실패·누락된 검증과 겹친 점유를 기록합니다. Supervisor는 상주 daemon이 아니라 요청 시 읽기 전용 점검 역할입니다.

### 모델과 도구 정책

Main의 모델은 사용자가 선택하거나 현재 설정을 상속합니다. 역할별 모델 설정은 설치된 도구의 네이티브 설정에 따르며, 모델 사용 권한은 저장소 테스트만으로 확인할 수 없습니다. 명시적인 선호 모델 사용 불가 오류 뒤에만 해당 역할의 허용된 대체 모델을 한 번 검토하세요. 일반 구현·테스트·도구·timeout 실패를 모델 대체 조건으로 취급하지 않습니다. [모델 라우팅 Skill](../.agents/skills/model-routing/SKILL.md)을 참고하세요.

## AI 도구 파일과 검증 범위

정본 역할·Skill은 Harness의 `harness/agents/`와 `.agents/skills/`에 있습니다. 설정·업데이트 계획은 선택한 도구의 관리 대상 파일만 `project/`에 배치합니다. Codex는 `.codex/agents/*.toml`, `.codex/config.toml`, 선택적 `.codex/hooks.json`, `.agents/skills/*`를 사용합니다. Claude Code는 `.claude/agents/*.md`와 `.claude/skills/*`, OpenCode는 `.opencode/agents/*.md`와 `.agents/skills/*`, Antigravity는 `.agents/agents/*/agent.md`와 `.agents/skills/*`를 사용합니다. 기존 사용자 파일은 소유권·해시·충돌 검사를 통과해야 하며, 관리 대상 밖의 파일은 변경하지 않습니다.

파일 배치와 기본 CLI 점검은 도구의 네이티브 역할 탐색, Skill 탐색, 권한, 훅 발송을 증명하지 않습니다. 2026-10-08 현재 새 Codex 세션의 native smoke는 아직 완료되지 않았습니다. 생성된 AGENTS의 점유 명령 수정이 검토 중이고 시험 환경의 Codex provider 연결도 사용할 수 없어, 실제 위임·훅 근거가 없습니다. Claude Code, OpenCode, Antigravity에도 실제 네이티브 성공을 주장하지 않습니다. [네이티브 스모크 절차](native-smoke-worksheet.md)는 검증 절차이지 통과 기록이 아닙니다.

같은 날짜의 준비 검증에서는 원격이 없는 빈 프로젝트의 독립 복사본에서 대화형 `setup`, `init`, `status`, `self-check`가 각각 종료 코드 0이었고, 전체 코드 테스트는 611개 통과·5개 건너뜀·실패 0개였습니다. 이는 설정·CLI·테스트 근거이며 네이티브 실행 검증은 아닙니다.

기존 `scripts/export-target.mjs` 후보 묶음과 `scripts/sync.mjs` 일반 쓰기는 별도 실험 경로입니다. 새 설정 브리지가 파일을 적용할 수 있다는 사실이 기존 후보 설치·일반 sync의 네이티브 게이트를 해제하지 않습니다. 과거 절차가 필요하면 [상세 첫 사용 절차](advanced-first-use.md)와 [생성기 설명](cross-tool-generator.md)을 참조하세요. 이 고정 프로젝트의 일상 명령에 과거 selector 인자를 붙이지 마세요.

## 문제 해결

- `setup` 계획이 충돌을 보고하면 적용하지 말고 대상 파일과 소유권을 확인하세요. 원격 복제 뒤 처음 발견된 충돌은 게시 전에 중단되므로 로컬 checkout에서 파일 목록을 검토하고 새 계획을 만드세요. 원본 또는 `project/`를 삭제·reset해 충돌을 없애지 마세요.
- `init`이 실패하면 먼저 설정이 적용되었는지, `project/.git`이 독립 Git 디렉터리인지 확인하세요. 이미 있는 runtime에 강제 초기화를 실행하지 말고 오류 내용을 보존하세요.
- `status`가 설정을 찾지 못하거나 `preview:live`가 열리지 않으면 Harness 폴더에서 실행 중인지 확인하고 서버가 실제로 출력한 localhost 주소를 사용하세요. 브라우저에서 `file://`로 열지 마세요. 포트 오류가 나면 해당 서버 실행 상태를 확인하고 오류를 기록하세요.
- 적용 실패 뒤 `.harness/`에 백업 또는 `journal`이 남았다면 복구 근거입니다. 임의로 지우거나 다른 설정 적용으로 덮지 말고, 소유된 파일과 현재 해시를 확인한 명시적 복구·검토 후 재시도하세요. 자동 복구 명령은 아직 안내하지 않습니다.

## 점검과 보존

`npm test`와 `npm run self-check`는 엔진 자체 검사를 수행합니다. 테스트 통과만으로 실제 도구 탐색·훅 발송·기존 프로젝트 전환이 확인된 것은 아닙니다. 프로젝트 파일과 `.harness/`의 설치 상태를 독립적으로 검토하고, 사적인 파일이나 자격 증명을 Git에 넣지 마세요. 적용 실패 시 백업과 journal을 보존하고 원본을 직접 지우거나 강제 reset하지 마세요. 원인을 확인한 뒤 같은 계획의 재시도 또는 검토된 복구 절차를 사용합니다.
