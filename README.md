# Pure Harness

Pure Harness는 프로젝트의 에이전트 역할·Skill과 작업 기록을 관리하는 도구입니다. Harness 설치 한 개에는 고정된 `project/` 한 개가 있으며, 그 폴더가 독립적인 Git 저장소입니다. 설치 상태와 작업 기록은 Git에서 무시되는 `.harness/`에 보관합니다.

## 처음 시작하기

Node.js 20+와 Git을 준비하고, 설치할 상위 폴더에서 Harness를 clone한 다음 설정하세요.

```powershell
git clone https://github.com/ZaRi1l/pure_harness_engineering.git
Set-Location .\pure_harness_engineering
npm run setup
```

설정 질문에 따라 다음 중 하나를 고릅니다.

- 새 프로젝트: 빈 `project/`를 만들고 독립 Git 저장소로 시작합니다.
- 기존 프로젝트: 로컬 Git 원본 또는 Git 원격을 지정합니다. 로컬 원본은 변경하지 않고 커밋 기록과 작업 파일을 `project/`로 복사하며, 파일 목록·충돌을 계획에서 검토합니다. 원격은 HEAD만 고정하고 파일 목록은 계획 시 확인되지 않습니다. 복제 후 새 충돌이 발견되면 적용을 중단하므로 로컬 checkout을 준비해 다시 검토하세요.

사용할 AI 도구(Codex, Claude Code, OpenCode, Antigravity)를 고르고, 표시된 계획을 검토한 뒤 정확한 확인 문구를 입력해야 적용됩니다. 역할·Skill 파일이 배치되어도 각 도구의 실제 탐색·훅 실행까지 증명된 것은 아닙니다. 도구를 바꿀 때도 `npm run setup`에서 현재 프로젝트 업데이트를 계획·검토하세요.

설정 직후 Harness 폴더에서 `init`을 한 번 실행하고, AI 도구는 `project/` 폴더를 열어 사용합니다. 이후 평소에는 아래 두 명령으로 상태와 화면을 확인합니다.

```powershell
npm run init
```

```powershell
npm run status
npm run preview:live
```

`init`은 처음 한 번만 실행하세요. `preview:live`가 출력한 localhost 주소에 `#guide`를 붙여 엽니다. 서버 없이 보는 별도 예시는 [오프라인 갤러리](offline-gallery/index.html)를 파일로 직접 열 수 있습니다. 기존 프로젝트·runtime을 삭제하거나 초기화하지 않습니다. [처음 사용 가이드](docs/first-use.md)와 [설정·운영 참고](docs/setup-reference.md)에 안전한 적용과 검증 범위가 있습니다.
