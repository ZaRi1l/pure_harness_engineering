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
