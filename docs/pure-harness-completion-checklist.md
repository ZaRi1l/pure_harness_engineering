# Pure Harness 완료 확인표 — 활성 목표 기준

이 표는 2026-10-08 활성 `/goal`의 [완성 설계](superpowers/specs/2026-10-08-pure-harness-completion-design.md)에 대한 관찰 기준이다. [진행 기록](pure-harness-completion-progress.md)에 명령·로그·파일 diff·네이티브 세션 증거를 연결한다. `05c1ba4`는 시작 기준이다. 아래 표의 오래된 SHA별 수치는 당시 기록으로 보존하며, **현재 판정은 바로 다음 2026-10-12 절을 우선**한다.

## 2026-10-12 현재 판정: 구현 게시와 native 수락 분리

- 최종 코드 SHA는 `4a599c4c87f57c7432e66abd617a0dfbe793a109`다. 이 SHA에서 전체 `npm test`는 실제 exit 0, 622건 중 617 통과·0 실패·5 skip이었다. 문서 전용 출시 commit의 전체 시험은 별도 실행 결과로 판정한다. 문서 전용 commit에서 native-critical 코드와 생성 출력의 digest가 같을 때에만 기존 코드 시험·중립 복사본 증거를 해당 코드 범위에 승계한다.
- remote 없는 중립 복사본의 실제 세 롤아웃(root·worker·planner)에서 3/3 thread, processed token 298617, tool call 11, compaction 0을 읽기 전용으로 관찰했다. 연결 정보가 없어 token은 100% unattributed이며 역할별 비용/작업별 귀속을 주장하지 않는다. 실제 역할 ID·5개 프로젝트 hook dispatch는 관찰했지만, 중첩 native 손자 lineage는 지원되지 않아 fail-closed다.
- 실제 Node hello CLI 생성·실행과 `node --test` 실행, Skill 소비, read-only planner 경로는 **미검증**이다. Windows native 실행 helper가 `node_repl.exe`의 `os error 32`와 `helper_unknown_error: setup refresh had errors`로 명령 시작 전에 실패했다. 바깥 `codex exec` 프로세스 exit 0은 안쪽 명령 성공이 아니다. 따라서 `nativeSmoke`·cutover·전체 `/goal`을 완료로 승격하지 않는다. 다른 세 target도 `unverified`다.
- 사용자는 2026-10-12에 **검증된 구현 업그레이드의 `main` push와 미완료 native E2E를 분리**해 게시하도록 명시 승인했다. 이 승인은 native 수락 완료나 원본 제품 cleanup, 전역 설정·모델·CLI 설치·sandbox/ACL 변경을 승인한 것이 아니다. 작업 브랜치/worktree와 무관한 사용자 자산은 보존한다.

| 요구 | 현재 사실 | 완료에 필요한 관찰 |
| --- | --- | --- |
| 화면·가이드 통합 | UI/가이드·갤러리 통합 뒤 `7d1a8c9` 전체 `npm test` 통과; 과거 `135608e`의 오래된 `guideCopy` 테스트 1건(단언 3개) 실패는 진행 기록에 보존 | 실제 위젯/모듈 연결 DOM 테스트, 탭·오류·차단 경로, 관련 전체 suite 및 가이드 링크 통과 |
| 고정 단일 배치·Git 경계 | 고정 컨텍스트·runtime 통합 뒤 `7d1a8c9` 전체 `npm test` 통과; clean 중립 복사본 실제 경계 시험은 진행 중 | Harness의 유일한 `project/`에 자체 Git·제품 소스, `.harness/`에 로컬 상태; 코어 ignore가 양쪽 제외; child `.git` 부재 시 부모 Git fallback 거부, symlink/reparse·두 번째 프로젝트 거부 |
| 새 프로젝트 시작 | setup 소유 5개 commit·CLI 4개 commit과 `package.json`의 setup 명령이 `135608e`에 통합됨; 결합 집중 시험 136/136 통과, 실제 cold start/첫 Codex 작업은 미실행 | 제안된 `npm run setup` 읽기 전용 계획 뒤 고정 child에 안전한 Git 생성; `status`/`preview:live`가 3플래그 없이 자기 설치 컨텍스트 사용; 첫 Codex 작업 관찰 |
| 기존 프로젝트 연결 | 격리 시험 안내와 후보 설치만 있음 | 원본 유지한 검토 후 복사/clone, child remote/history 보존, 미추적·무시 파일 판단 표시, AGENTS/사적 설정/`.ai` 보존, 충돌 중단·롤백 fixture |
| 기존 아티팩트 분류 | 과거 `135608e` remote fixture 4건 실패는 runner 수정 뒤 `7d1a8c9` 전체 suite에서 재통과; 실제 원본 cleanup은 승인 범위 밖 | 경로/해시/내용/소유권 inventory로 범용·제품 전용·데이터·혼합 분류; 중립 부분만 검토 후 canonical 추출, 혼합 분리, 제품 정책 유입·원본 변경 없음 |
| 로컬 상태와 네이티브 브리지 | `7d1a8c9` 자체 점검 PASS였으나 생성 child AGENTS에 제거된 3-flag claim 명령이 남은 결함을 cold start에서 발견했다. `3693951`은 이를 고쳐 실제 PowerShell claim/release를 검증했고 bridge/runtime 82/82 통과; 새 전체 게이트·native 재시험 대기 | 단일 `.harness/`에 명령·훅·UI 기록; `project/` 세션의 부모 AGENTS 상속 범위 명확화; 소유된 정적 역할/Skill은 Node 없이 소비 가능 |
| 제품 비의존 cold start | `7d1a8c9`의 정확한 복사본에서 생성 AGENTS 명령 결함을 관찰해 해당 SHA를 최종 코드 기준에서 제외했다. 수정 후보의 새 복사본·native 검증 대기 | 전체 통합 테스트를 통과한 최종 코어 SHA를 새 remote 없는 폴더에 복사, 자체 Git·remote 없는 빈 중립 child, 구형 제품 접근 불가, child에 구형 Harness 디렉터리/스크립트 0개; 자체 소스만으로 plan/apply·Codex 브리지·tasks/runtime·UI·telemetry missing/안전 입력·Node 없는 정적 프로필 관찰; 정적 repo/import/path 순수성과 런타임 독립성 모두 통과 |
| Lifecycle·텔레메트리 | 훅 및 수동 rollout 가져오기 일부 있음 | 실제 ID/turn token 재개·정지 조정, 불명 상태 미추론, 실제 선택 rollout의 부분/미귀속/오류·stale 표시와 본문/자격 증명 비노출 |
| 전환·업데이트 | `checkCutover`는 의도적으로 항상 실패 | 백업·inventory·pointer 원자 교체/복원 fixture, 브리지가 관찰한 세션·writer·claim의 직접 증거; 외부/생존 상태 미상은 차단, 가짜 0건 거부; 원본 전환은 별도 승인 |
| Codex 네이티브 | 설치 0.161.0, 이전 spawn 호출 0회; 역할 가능 여부 미검증 | 실제 지원 스키마/호출 응답, 새 세션 역할·Skill·현재 계약의 버전 지원 다섯 훅 및 권한 경계 관찰·독립 검토; 실패 항목은 미완료 |
| 최종 앱 E2E | 아직 중립 실제 앱 시험 전 | 최종 코어 복사본의 네이티브 Codex가 의존성 없는 Node hello CLI와 테스트를 child에 생성; 명령·테스트 실제 실행/exit code, 정확한 agent ID·작업/runtime·실제 rollout 이후 telemetry 확인; 예상 token 수치 사전 기입 금지 |
| 실제 절차 문서 | 기존 문서는 수동/후보 절차 중심 | E2E에 성공한 정확한 명령·출력·실패 복구로 첫 사용/운영 문서 갱신 후 문서 절차 재실행 |
| 작업 브랜치 정리 | 현 설계 단계에 여러 작업 브랜치/worktree 존재 | E2E 통과 **후** 출처 inventory, main 또는 검토 동등 patch의 포함 증명, main/승인 remote/시험 복사본 SHA·테스트 대조, 미커밋/ignored 보존; 작업 소유·깨끗한 것만 삭제, 불명/무관 사용자 자산 보존·blocker 보고, 승인 최종 push 뒤 불필요한 작업 브랜치 0개 |
| 다른 세 대상 | 후보 생성 가능, 네이티브 스모크 모두 미검증 | 이번 밤샘 완료를 주장하지 않음; 버전별 후보·한계·`unverified`를 그대로 보고 |
| 전체 마감 | clean `7d1a8c9`에서 `npm test` 616건 중 611 통과·0 실패·5 skip, exit 0; self-check exit 0/WARN. 중립 native E2E·실제 문서 재연·작업 정리·`main` push는 미완료 | 구현 후 정확한 새/기존 절차, 테스트 명령·결과, 남은 위험·외부 관찰 불가 항목을 사용자에게 전달 |

`nativeSmoke`나 cutover 상태는 문서·후보 파일·테스트 fixture의 존재만으로 승격하지 않는다. **작업 Git 브랜치 정리**와 달리 원본 제품 프로젝트 cleanup, legacy 데이터 이관, 글로벌 도구/인증/모델 변경은 이 확인표의 완료 조건이 아니다.
