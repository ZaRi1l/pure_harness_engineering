# Pure Harness 처음 사용하기

Windows PowerShell 7 기준입니다. Node.js 20+와 Git이 필요합니다. Harness 설치 한 개는 고정된 `project/` 한 개만 관리합니다. `project/`는 Harness 자체와 별개의 Git 저장소이고, 로컬 설치 상태·작업 명세·메모리·runtime은 무시되는 `.harness/`에 둡니다.

먼저 설치할 상위 폴더에서 Harness 저장소를 clone하거나, 이미 준비된 Harness 설치 폴더로 이동하세요. 이미 clone했다면 첫 명령은 건너뜁니다.

```powershell
git clone https://github.com/ZaRi1l/pure_harness_engineering.git
Set-Location .\pure_harness_engineering
npm run setup
```

설정에서 새 프로젝트 또는 기존 프로젝트를 선택하고, 사용할 AI 도구를 고릅니다. 설정은 파일 변경 계획과 충돌·검증 한계를 먼저 보여 줍니다. 내용을 확인한 뒤 화면에 표시된 정확한 `apply <계획 해시 앞 12자리>` 문구를 입력해야 적용됩니다. 취소하면 파일을 적용하지 않습니다.

## 새 프로젝트라면

`setup`에서 **새 프로젝트**를 고르세요. 비어 있거나 없는 `project/`에 독립 Git 저장소가 준비됩니다. 별도 프로젝트 ID, checkout, binding 파일을 만들 필요가 없습니다. `project/`에 작업 파일을 만들고 AI 도구도 그 폴더에서 여세요.

## 기존 프로젝트라면

`setup`에서 **기존 프로젝트**를 고르고 로컬 Git 저장소의 절대경로 또는 지원되는 Git 원격을 지정하세요. 로컬 원본은 이동하거나 수정하지 않습니다. 계획을 적용하면 원본의 Git 기록과 파일이 고정된 `project/`에 복사됩니다. 로컬 원본의 커밋되지 않은 파일과 무시된 파일도 점검·복사 대상이므로 계획의 충돌과 사적인 데이터를 확인하세요. 원격은 계획 시 HEAD만 고정되며 파일 목록과 충돌은 미확인입니다. 복제 후 새 충돌이 드러나면 `project/` 게시 전에 중단합니다. 이때는 로컬 checkout을 준비해 전체 파일·충돌을 다시 검토하세요. 이미 `project/`에 다른 데이터가 있다면 덮어쓰지 말고 충돌을 해결하세요. 기존 runtime을 삭제하거나 초기화하지 마세요. 기존 파일은 검토 없이 덮어쓰지 않습니다.

## 설정 후 확인

Harness 폴더에서 다음 명령을 실행합니다. 처음 설정한 뒤에만 `init`을 실행하고, 이후에는 `status`와 `preview:live`를 사용하세요.

```powershell
npm run init
npm run status
npm run preview:live
```

AI 도구에서는 Harness 설치 루트가 아닌 `project/` 폴더를 프로젝트로 여세요. Codex 첫 세션에서는 이 폴더의 신뢰 여부를 검토해 승인하고, `/hooks`에서 현재 훅의 정확한 정의와 명령을 확인한 뒤 신뢰 여부를 결정하세요. 생성된 설정 파일만으로 훅 실행 권한이 승인되지는 않습니다.

`preview:live`가 실제로 출력한 localhost 주소에 `#guide`를 붙여 엽니다. `preview/index.html`을 `file://`로 직접 여는 방식은 지원되지 않습니다. 서버는 `Ctrl+C`로 종료합니다. 이미 설정된 설치에서 AI 도구를 바꿀 때는 `npm run setup`으로 기존 프로젝트의 업데이트 계획을 검토하세요. 도구 파일 설치만으로 네이티브 역할 탐색·Skill 탐색·훅 발송을 확인했다고 간주하지 마세요.

서버 없이 화면 예시만 보려면 Harness 설치의 [오프라인 갤러리](../offline-gallery/index.html)를 브라우저에서 직접 여세요. 이 페이지는 `file://`로 열 수 있으며 live `#guide`나 실제 프로젝트 runtime 화면이 아닙니다. 브라우저가 갤러리 안의 iframe을 막으면 [독립 예시](../offline-gallery/tasks/example.html)를 별도 탭으로 여세요.

문제가 생기면 [설정·운영 참고](setup-reference.md)를 확인하세요. 이전 다중 프로젝트/후보 묶음 흐름을 조사해야 한다면 [레거시 상세 절차](advanced-first-use.md)를 참고하되, 이 고정 프로젝트 설정에 이전 selector 명령을 섞지 마세요.
