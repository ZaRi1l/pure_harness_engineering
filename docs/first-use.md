# Pure Harness 처음 사용하기

Windows PowerShell 7 기준입니다. Node.js 20+와 Git이 필요합니다. **Harness 설치 하나와 프로젝트 하나**로 시작하세요. 아래에서 자신의 상황 하나만 고르면 됩니다.

## 1. 이미 설정된 로컬 프로젝트 확인

프로젝트 `harness-adapter/project.json`과 Harness 설치의 `harness-adapter/binding.local.json`이 이미 준비되어 있다면, 새로 만들거나 초기화하지 마세요.

1. 터미널에서 Harness 설치 폴더로 이동합니다: `Set-Location C:\tools\pure-harness` (자신의 경로로 변경).
2. 자신의 ID·프로젝트 checkout·binding 절대경로를 넣어 실행합니다:

   ```powershell
   npm run preview:live -- --project my-project --checkout C:\work\my-project --binding C:\tools\pure-harness\harness-adapter\binding.local.json
   ```

3. 터미널에 **실제로 출력된 localhost 주소**를 브라우저에서 엽니다. 끝나면 같은 터미널에서 `Ctrl+C`로 종료합니다.

이미 설정된 환경에도 `--project`, `--checkout`, `--binding` 세 값이 모두 필요합니다. 화면의 작업 기록은 선택한 프로젝트의 Harness runtime에 저장됩니다. [화면에서 확인할 것](advanced-first-use.md#3-화면에서-첫-작업-확인)과 [문제 해결](advanced-first-use.md#막히면)을 참조하세요.

## 2. 새 프로젝트 시작

1. Harness를 설치하고 **별도의 형제 폴더**에 새 빈 Git 프로젝트를 만듭니다. 두 폴더를 서로 안에 넣지 마세요.
2. 프로젝트 checkout에 `harness-adapter/project.json`을 만들고, Harness 설치에 로컬 전용 `harness-adapter/binding.local.json`을 만듭니다. 프로젝트 ID는 두 파일에서 같아야 합니다.
3. Harness 폴더에서 읽기 전용 진단을 통과한 뒤 `init`, `status`, `preview:live` 순서로 실행합니다. 명령과 JSON 예시는 [새 프로젝트 상세 절차](setup-reference.md#새-프로젝트를-처음-시작할-때-windows-powershell-7)에 있습니다.

`projects/<id>/tasks`, `memory`, `runtime`은 Harness 안의 **관리 데이터 경로**입니다. 제품 소스 checkout은 별도 Git 폴더입니다. 이미 작업 중인 디렉터리에는 이 새 프로젝트 절차를 실행하지 마세요.

## 3. 기존 프로젝트를 안전하게 시험

1. 원본을 보존하고 Harness와 기존 프로젝트를 각각 **새 시험용 Git checkout**으로 복사합니다. 커밋되지 않은 파일과 무시된 데이터는 복사되지 않습니다.
2. 시험용 프로젝트에만 manifest를 준비하고, 시험용 Harness에만 binding을 만듭니다. 기존 파일은 덮어쓰지 않습니다.
3. 시험 복사본에서 진단 → `init` → `status` → `preview:live`를 실행합니다. 정확한 복사·검사 명령은 [격리 시험 상세 절차](advanced-first-use.md#2-기존-프로젝트를-격리-복사해-시험하기)를 따르세요.

등록과 화면 확인은 AI 도구 설정·훅 설치나 기존 runtime 이관이 아닙니다. 자동 연결이 필요하다면 [전환 게이트](project-isolation-cutover.md)를 먼저 확인하세요. 여러 프로젝트 등록, 도구별 후보 설치, 토큰 가져오기는 처음 실행할 때 필수가 아닙니다.
