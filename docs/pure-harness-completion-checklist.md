# Pure Harness 완료 확인표 — 설계 승인 전 기준

이 표는 [완성 설계](superpowers/specs/2026-10-08-pure-harness-completion-design.md)의 관찰 기준이다. 구현 기준 커밋 `05c1ba4`에서 충족하지 않은 항목을 완료로 표시하지 않는다. 명령·로그·파일 diff·네이티브 세션 증거를 각 구현 작업의 검증 기록에 남긴다.

| 요구 | 현재 사실 | 완료에 필요한 관찰 |
| --- | --- | --- |
| 화면·가이드 통합 | `f3424b7`, `60c8c2e` 준비, 아직 미통합; 로케일 `551168e`는 독립 검토·63/63 통과, 통합 및 일부 오류 문구 보완 대기 | 실제 위젯/모듈 연결 DOM 테스트, 탭·오류·차단 경로, 관련 전체 suite 및 가이드 링크 통과 |
| 고정 단일 배치·Git 경계 | 구현 기준은 외부 checkout·project ID·binding 3입력 | Harness의 유일한 `project/`에 자체 Git·제품 소스, `.harness/`에 로컬 상태; 코어 ignore가 양쪽 제외; child `.git` 부재 시 부모 Git fallback 거부, symlink/reparse·두 번째 프로젝트 거부 |
| 새 프로젝트 시작 | 수동 manifest/binding 절차만 있음 | 제안된 `npm run setup` 읽기 전용 계획 뒤 고정 child에 안전한 Git 생성; `status`/`preview:live`가 3플래그 없이 자기 설치 컨텍스트 사용; 첫 Codex 작업 관찰 |
| 기존 프로젝트 연결 | 격리 시험 안내와 후보 설치만 있음 | 원본 유지한 검토 후 복사/clone, child remote/history 보존, 미추적·무시 파일 판단 표시, AGENTS/사적 설정/`.ai` 보존, 충돌 중단·롤백 fixture |
| 기존 아티팩트 분류 | `.ai/`·`.codex/`·`.agents/`의 성격은 파일마다 다름 | 경로/해시/내용/소유권 inventory로 범용·제품 전용·데이터·혼합 분류; 중립 부분만 검토 후 canonical 추출, 혼합 분리, 제품 정책 유입·원본 변경 없음 |
| 로컬 상태와 네이티브 브리지 | 선택 runtime과 후보 생성 일부 있음 | 단일 `.harness/`에 명령·훅·UI 기록; `project/` 세션의 부모 AGENTS 상속 범위 명확화; 소유된 정적 역할/Skill은 Node 없이 소비 가능 |
| 제품 비의존 cold start | 구형 제품 파일 없이 새 배치 검증 전 | 깨끗한 코어 clone + 자체 Git의 빈 중립 child, 구형 제품 접근 불가, child에 구형 Harness 디렉터리/스크립트 0개; 자체 소스만으로 plan/apply·Codex 브리지·tasks/runtime·UI·telemetry missing/안전 입력·Node 없는 정적 프로필 관찰; 정적 repo/import/path 순수성과 런타임 독립성 모두 통과 |
| Lifecycle·텔레메트리 | 훅 및 수동 rollout 가져오기 일부 있음 | 실제 ID/turn token 재개·정지 조정, 불명 상태 미추론, 실제 선택 rollout의 부분/미귀속/오류·stale 표시와 본문/자격 증명 비노출 |
| 전환·업데이트 | `checkCutover`는 의도적으로 항상 실패 | 백업·inventory·pointer 원자 교체/복원 fixture, 브리지가 관찰한 세션·writer·claim의 직접 증거; 외부/생존 상태 미상은 차단, 가짜 0건 거부; 원본 전환은 별도 승인 |
| Codex 네이티브 | 설치 0.161.0, 이전 spawn 호출 0회; 역할 가능 여부 미검증 | 실제 지원 스키마/호출 응답, 새 세션 역할·Skill·현재 계약의 버전 지원 다섯 훅 및 권한 경계 관찰·독립 검토; 실패 항목은 미완료 |
| 다른 세 대상 | 후보 생성 가능, 네이티브 스모크 모두 미검증 | 이번 밤샘 완료를 주장하지 않음; 버전별 후보·한계·`unverified`를 그대로 보고 |
| 전체 마감 | 위 항목의 부분 구현만 존재 | 구현 후 정확한 새/기존 절차, 테스트 명령·결과, 남은 위험·외부 관찰 불가 항목을 사용자에게 전달 |

`nativeSmoke`나 cutover 상태는 문서·후보 파일·테스트 fixture의 존재만으로 승격하지 않는다. 원본 프로젝트 cleanup, legacy 데이터 이관, 글로벌 도구/인증/모델 변경은 이 확인표의 완료 조건이 아니다.
