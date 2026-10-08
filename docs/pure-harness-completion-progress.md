# Pure Harness 완성 진행 기록 — 2026-10-08 활성 `/goal`

사용자는 [완성 설계](superpowers/specs/2026-10-08-pure-harness-completion-design.md)에 따른 상세 계획, 구현, 독립 검증, 통합, `main` push 및 검증된 작업 브랜치 정리를 연속 실행하도록 승인했다. 일반 단계마다 추가 승인 대기로 멈추지 않는다. 범위가 실질적으로 커지거나 원본 제품 정리·실제 legacy runtime 전환/이관이 필요하면 별도 결정을 받는다. 이 파일은 상태 표시를 꾸미는 대시보드가 아니라 [완료 확인표](pure-harness-completion-checklist.md)의 증거 색인이다. 아래 `대기`는 통과가 아니다.

| 작업 흐름 | 연결된 완료 기준 | 현재 상태 | 필요한 실제 증거 |
| --- | --- | --- | --- |
| 화면·가이드 통합 | 화면·가이드 통합 | 대기 | 통합 SHA, 실제 모듈 DOM/오류/내비게이션 테스트 명령·결과, 전체 관련 suite |
| 단일 배치와 시작 | 고정 단일 배치·Git 경계, 새 프로젝트 시작, 기존 프로젝트 연결, 기존 아티팩트 분류 | 대기 | 고정 child/코어 ignore·Git 정체성 테스트, plan 무변경, 신규/기존 Apply·충돌·롤백, 분류 inventory |
| 독립 코어와 연결 | 로컬 상태와 네이티브 브리지, 제품 비의존 cold start | 대기 | 정적 repo/import/path 순수성, 최종 SHA의 remote 없는 시험 복사본, 중립 child의 실행 결과 |
| 런타임·전환 안전 | Lifecycle·텔레메트리, 전환·업데이트 | 대기 | 실제 ID/턴·훅 기록, privacy·missing/partial/unattributed, 가짜 0건 거부와 백업·롤백 fixture |
| 네이티브 실사용 | Codex 네이티브, 다른 세 대상, 최종 앱 E2E | 대기 | 설치 버전·스키마/호출 응답, 새 세션 역할·Skill·훅, Node hello CLI 생성·실행·테스트 exit code, 실제 rollout 후 telemetry; 나머지는 미검증 표시 |
| 문서와 출시 | 실제 절차 문서, 전체 마감, 작업 브랜치 정리 | 대기 | 실제 성공 단계로 갱신한 문서 재실행, 최종 `main`/승인 remote/시험 복사본 SHA, push 결과, 작업 브랜치/worktree 출처·보존·정리 inventory |

순서는 **승인된 변경 전부 통합 → 통합 전체 테스트 → 최종 SHA를 새 일회용 폴더에 복사 → 빈 중립 child의 실제 Codex 앱 E2E → 관찰된 절차로 문서 갱신 → 검증된 작업 Git 정리와 `main` push 확인**이다. 병렬 writer는 각자 분리된 브랜치/worktree와 범위 지정 파일을 소유한다. 같은 checkout의 겹치는 경로는 순차 처리한다. 무관한 사용자 브랜치·데이터와 미커밋/ignored 유용 파일은 보존한다. 출처나 통합 증명이 없으면 삭제하지 않고 blocker로 기록한다.

실제 증거를 추가할 때는 각 행에 테스트 명령, 관찰 결과, 관련 commit/SHA, 실패·미확인 항목을 적는다. 계획서·fixture의 존재, 모델의 주장, 예상 token 숫자만으로 행을 완료로 바꾸지 않는다. `nativeSmoke`와 cutover는 실제 독립 증거와 별도 검토 없이는 `unverified`/fail-closed를 유지한다.

## 고정 컨텍스트 계획 사전 점검 (구현 전)

[고정 컨텍스트 계획](superpowers/plans/2026-10-08-fixed-project-context.md)의 네 작업은 파일 소유권과 인터페이스 의존성을 점검했다. 아래는 **계획 일관성** 기록이지 구현 통과 증거가 아니다. 활성 `/goal`은 통상적인 Skill 인간 검토 대기 없이 범위 내 실행을 허용한다. 명시적인 병렬 구현 요청에 따라 writer는 분리된 worktree/브랜치에 두며, 같은 checkout의 겹치는 파일은 순차 처리한다.

| 작업 | 인터페이스/의존성 확인 | 상태 |
| --- | --- | --- |
| T1 고정 컨텍스트 | 정확히 7개 키의 `.harness/config.json` (`version/layout/projectPath/target/setupId/createdAt/updatedAt`), 고정 canonical child와 동일 child Git 정체성 매번 검증, 임의 root 금지; fixture worktree에는 child 최초 commit 필요 | 계획 승인, 구현 대기 |
| T2 runtime/claim | T1 branded context 소비; 제품 checkout과 `.harness/` 설치 scope 분리, `--core`는 코어만 | T1 후 실행 |
| T3 reader/catalog | T2 `contextFromArgs` 소비; 작업 링크는 `.harness/tasks`, 역할/Skill catalog의 canonical 소스는 checkout이 아닌 별도 `harnessRoot` | T2 후 실행 |
| T4 self-check | T1 고정 loader 소비; setup 전 코어 검사와 setup 후 child identity 검사 구분 | T1 후 실행 |

Root가 공유한 기준 실행 결과는 `npm test`: 총 484, 통과 479, 실패 1, skip 4, exit 1이다. 실패는 기존 README 기대값 `tests/preview-server.test.mjs:341-345`이며 승인된 가이드 변경 `60c8c2e` 통합에서 재검증할 항목이다. 이 기록은 실패를 통과로 해석하지 않는다. 화면 통합 T1은 별도 `D:/dev/pure_harness_dashboard_complete` worktree의 `codex/dashboard-completion` 브랜치에서 기준 `2a4b5d2`로 실행 중이라고 Root가 보고했다. 결과와 통합 SHA는 아직 대기다.

## 화면·최종 E2E 계획 사전 점검 (구현 전)

[화면·최종 E2E 계획](superpowers/plans/2026-10-08-dashboard-completion-e2e.md)은 실제 위젯과 독립적인 고정 컨텍스트/설치/네이티브 브리지 인터페이스를 잇는다. 아래는 계획 검토 기록이며 통과 증거가 아니다.

| 작업 | 의존성·수락 경계 | 상태 |
| --- | --- | --- |
| UI T1→T2→T3 | 복원 화면·가이드를 합친 뒤 실제 widget/controller를 연결한 DOM/HTTP 시험, locale·오류·지연 응답·초안 보존; runtime 의미를 UI에 복제하지 않음 | T1 별도 worktree 실행 중; T2/T3 대기 |
| T4 통합 | 검토된 컨텍스트·setup·native bridge와 UI를 한 tree에 통합; 모든 관련 테스트 뒤 `CODE_SHA` 고정 | 선행 작업 대기 |
| T5→T6 실사용 | `CODE_SHA`의 새 remote 없는 중립 복사본 cold start 후 지속형 비-ephemeral 네이티브 Codex 세션에서 hello CLI·테스트·실제 rollout 관찰 | 대기; 기본/글로벌 trust 변경이나 위험한 hook 우회 금지 |
| T7 문서·증거 | 성공한 실제 단계만 문서화; `CODE_SHA`와 문서 후 `RELEASE_SHA`를 구분하고 native-critical closure digest가 같을 때만 이전 native 증거 승계 | 대기; 두 commit SHA가 같다고 꾸미지 않음 |
| T8 출시·정리 | 최종 SHA의 테스트·중립 복사본·native 증거 검증 뒤 출처/포함 증명된 작업 브랜치만 정리하고 승인된 main push 확인 | 대기; 무관/불명 자산은 보존 |

고정 컨텍스트 T1은 Root 보고에 따르면 `D:/dev/pure_harness_fixed_context`의 분리 worktree에서 기준 `6162746`으로 실행 중이다. UI T1의 기준은 위에 기록한 `2a4b5d2`다. 두 작업의 결과·실제 테스트 명령·통합 SHA는 아직 수신되지 않았다.

## 설정·네이티브 브리지 계획 사전 점검 (구현 전)

[설정·브리지 계획](superpowers/plans/2026-10-08-project-setup-bridge.md)은 고정 컨텍스트의 정확한 7키 config와 branded context를 소비한다. 아래는 계획 인터페이스 검토일 뿐 실제 Apply·네이티브 시험 결과가 아니다.

| 작업 | 생산·소비 및 검토 경계 | 상태 |
| --- | --- | --- |
| T1 source inventory | 원본 Git/head·파일 해시·범용/제품/데이터/혼합 분류의 읽기 전용 fingerprint를 T2에 제공 | 분리 worktree 착수 예정 |
| T3 bridge | canonical 역할/Skill에서 생성한 path별 action·before/after digest·충돌 목록을 T2에 제공; 기존 후보/시험 설치 게이트와 별개 | T1과 병렬 분리 worktree 착수 예정 |
| T2 setup transaction | T1 fingerprint와 T3 action/digest를 소비; staging의 Git와 원하는 bridge plan을 읽기 전용 검증 → 고정 child 원자 publish → canonical 위치에 bridge Apply → 7키 config 마지막 기록. 실패 시 소유 journal/bytes와 이전 빈 디렉터리 복원 | T1/T3 이후 |
| T4 setup CLI/hook | T2 setup 계약과 T3 생성 hook 명령을 소비; cwd가 아닌 설치 경로 고정 | T2/T3 이후 |
| T6 공통 지침 | canonical 경로·제품 AGENTS managed block을 T3와 조정; 지침 수정 뒤 T3 재렌더·digest 재검증 | T3와 조정하며 진행 |
| T5 독립 수락 | T1–T4와 T6의 결과를 중립 fixture에서 재검증; 기존 원본 보존과 native 미검증 표시 확인 | 선행 작업 이후 |

Root 보고 기준 구현 흐름은 고정 컨텍스트·UI·source inventory·native bridge의 네 분리 worktree/브랜치다. 같은 파일의 동시 writer는 없고 통합은 순차 조정한다. 새 managed bridge Apply가 성공해도 기존 후보 export/disposable-trial 게이트를 해제하지 않으며 `nativeSmoke`는 실제 세션 관찰 전까지 `unverified`다. 비밀값·프롬프트/출력 본문 analytics, 원본 제품 cleanup은 범위 밖이다. 계획 세 개가 완료 기준을 덮고 있다는 것은 범위 확인이지 코드·시험 완료 주장이 아니다.

## 작업별 중간 증거 (Root 전달; 최종 통합 전)

| 작업 | 전달된 commit/검증 | 판정·남은 검증 |
| --- | --- | --- |
| UI T1 | `33a2cc8`, 독립 검토 완료, 집중 테스트 38 통과; 앞선 전체 suite 486건 중 482 통과·4 skip | 개별 작업 검토 완료. 최종 통합 DOM/전체 suite는 별도 대기 |
| 고정 컨텍스트 T1 | `178b14e`, 독립 검토 완료, 45 통과·1 skip | 개별 작업 검토 완료. T2 및 통합 경계 재검증 대기 |
| source inventory 수정 | `202fd3c`, 집중 테스트 8/8 통과 | 재검토 대기; T2의 source fingerprint 입력으로 승인 전까지 확정하지 않음 |
| native bridge | `8bd759d`, 집중 테스트 46 통과·2 skip | 독립 검토 대기; managed Apply와 native smoke를 혼동하지 않음 |
| UI T2 | `87e7ae7`, 집중 테스트 122/122 통과 | 독립 검토 대기; 실제 통합 위젯/HTTP 경계 재확인 필요 |
| 고정 컨텍스트 T2 | 실행 중, commit/결과 미수신 | runtime/claim 경계 결과 대기 |

이 수치는 Root가 전달한 작업별 결과이지 여기서 재실행한 증거가 아니다. 최종 완료 판단은 통합 브랜치의 정확한 SHA와 재실행 결과, 독립 검토, 중립 복사본 실사용 증거에 따른다. setup T2에서는 public `applyBridgePlan`에 `stagingRoot`를 넘기지 않는다. bridge plan만 staging에서 만들고, 실제 쓰기는 canonical `project/` publish 뒤 실행한다.

## 후속 마일스톤 (Root 전달; 위 중간 상태 갱신)

| 작업 | 전달된 commit·실행 결과 | 검토 상태·남은 일 |
| --- | --- | --- |
| 고정 컨텍스트 T2 | `de5a0a8`, runtime 집중 테스트 52/52 통과 | 수정 검증 완료; 구형 reader 소비자 실패는 T3 연결 전 상태이며, T3/통합 suite에서 재확인 |
| UI T2 | `7c499b4`, UI/HTTP 58건과 인접 65건 통과 | 독립 검토에서 추가 지적 없음; 최종 통합 DOM/HTTP 재실행 대기 |
| source inventory T1 | `a707187`, 12/12 통과, plan 중 임시 쓰기 없음 | 로컬 점검 결과. remote HEAD 긍정 경로는 parser 증거만 있어 실제 transport/네이티브 검증 대기 |
| 공통 지침 T6 | `7c3a619`, 독립 검토, 12 통과·2 skip | 개별 지침 검토 완료. 생성 child AGENTS/Skill의 T3 재렌더·digest·통합 검증 대기 |
| native bridge T3 | 기존 `8bd759d` 이후 안전·도구 간 소유권 여섯 건 수정 중 | 새 commit/테스트/독립 검토 미수신; `nativeSmoke`는 미검증 |
| 고정 컨텍스트 T3 | reader 연결 구현 중 | 결과·검토 미수신; 앞선 T2의 구형 소비자 실패 해소 확인 필요 |
| 고정 컨텍스트 T4 | `0ae290f` 검토에서 자체 config 오류가 fixture 상태에 가려지는 문제 발견 | 수정·재시험·재검토 진행 중; 통과 아님 |
| UI T3 | 지속 오류 메시지 로케일·lifecycle 문구 구현 중 | 결과·독립 검토 미수신 |
| 설정 T2 | 구현과 집중 테스트 진행 중 | 결과·독립 검토 미수신 |

최종 통합은 분리된 `D:/dev/pure_harness_final_integration`의 `codex/final-single-project-integration`에서 검토된 cherry-pick부터 시작했다는 Root 보고다. 이것은 아직 `main` 통합, 전체 suite, 중립 복사본/native 실사용 또는 push 증거가 아니다. 사용자의 활성 `/goal`에는 최종 `main` push가 포함되지만 그 완료 여부는 최종 SHA와 remote 확인 전까지 **대기**다. 이 구간은 전달된 수치·검토 메시지만 기록하며 실제 네이티브 ID, rollout, `CODE_SHA`/`RELEASE_SHA`를 만들어 적지 않는다.

## `135608e` 통합 중간 점검 (Root 전달; 전체 게이트 실패)

- Setup 소유 5개 commit과 CLI 4개 commit 및 `package.json`의 setup 명령이 통합됐다. 결합 집중 시험은 136/136 통과했다. 이것은 새 중립 설치의 실제 Apply나 native 실행 증거가 아니다.
- `npm run self-check`는 exit 0, 자체 검사 PASS로 보고됐다. 동시에 setup 미실행, 훅 미관찰, 글로벌 설정/auth/native 미검증 경고가 남아 있으므로 지원 완료나 hook 통과로 승격하지 않는다.
- UI/가이드는 개별 독립 검토 승인. 갤러리 `c6573ec`도 runtime 바이트 동일과 독립 9/9 검토 승인이 있으나 이 통합 SHA에는 아직 반영·재시험 대기다.
- `135608e`의 `npm test`는 607건 중 597 통과·5 실패·5 skip (exit 1)이었다. 실패는 오래된 dashboard `guideCopy` 테스트 1건(단언 3개)과 `NODE_TEST_CONTEXT` 없는 runner에서 실행된 source-inventory remote fixture 4건이다. 따라서 이 SHA의 전체 suite는 **실패**로 기록한다.
- 따라서 최종 통합 suite/self-check 재실행, 정확한 `CODE_SHA` 고정, remote 없는 중립 복사본, 실제 Codex hello 앱·agent ID·rollout telemetry, 관찰 기반 문서 갱신, `main` push/remote 대조와 작업 브랜치 정리는 모두 **미완료**다. 사용자용 production guide는 이 기록 단계에서 변경하지 않았다.

## clean `CODE_SHA` 전체 시험 통과 (Root 전달; native 게이트 별도)

- 최종 코드 기준은 `7d1a8c9a336aefb59d1a4197989dd7e80bf72285`다. 이 SHA의 `npm test`는 exit 0, 총 616건 중 611 통과·0 실패·5 skip, 실행 시간 321461ms였다. 앞선 `135608e`의 실패 기록은 해당 SHA의 과거 상태로 남기며 최신 통과로 소급 변경하지 않는다.
- 같은 기준의 `npm run self-check`는 exit 0이다. setup 미실행, hook 미관찰, native/model entitlement 미검증 WARN은 예상된 미검증 상태다. WARN을 실제 native 권한·훅 통과로 해석하지 않는다.
- `workerproject_setup_task2`가 정확한 코드 복사본에서 중립 cold-start를 진행 중이라고 Root가 전달했다. 아직 실제 setup/앱 실행·테스트·agent ID·rollout telemetry 결과가 도착하지 않아 모두 **대기**다. native ACK 없이 subagent ID를 추정해 기록하지 않는다.
- 관찰에 기반한 사용자 절차 문서 갱신/재연, 출시 SHA의 재시험, 검증된 작업 브랜치 정리, `main` push 및 remote SHA 대조도 **미완료**다. 이 문서 변경은 native-critical 코드/생성 출력의 동등성을 주장하거나 `nativeSmoke`를 승격하지 않는다.
