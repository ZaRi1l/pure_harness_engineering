((global) => {
  'use strict';

  const STORAGE = { locale: 'pure-harness-locale', theme: 'pure-harness-theme' };
  const messages = {
    en: {
      'preferences.language': '한국어',
      'preferences.languageLabel': 'Change language to Korean',
      'preferences.light': 'Light',
      'preferences.lightLabel': 'Change to light theme',
      'preferences.dark': 'Dark',
      'preferences.darkLabel': 'Change to dark theme',
      'dashboard.title': 'Live Dashboard',
      'dashboard.detail': 'Optional localhost view of current runtime state.',
      'app.tagline': 'Codex-native workflow',
      'nav.dashboard': 'Live Dashboard', 'nav.preview': 'Preview Lab', 'nav.agents': 'Agent Catalog',
      'nav.skills': 'Skill Catalog', 'nav.guide': 'Harness Guide',
      'sidebar.note': 'Live data refreshes every 3 seconds. Catalog records come from repository configuration.',
      'section.goal': 'Goal', 'section.phase': 'Phase', 'section.activeAgents': 'Reported Running Agents',
      'section.verification': 'Verification', 'section.tasks': 'Tasks', 'section.claims': 'Write Claims',
      'section.warnings': 'Watchdog Warnings', 'section.blockers': 'Blockers', 'section.signals': 'Signal Timeline',
      'section.network': 'Agent Signal Network', 'section.events': 'Recent Events', 'section.artifacts': 'Artifacts',
      'section.telemetry': 'Token Telemetry',
      'telemetry.unknown': 'Unknown', 'telemetry.stale': 'Stale — telemetry read failed; showing the last result.',
      'telemetry.status.observed': 'Observed', 'telemetry.status.partial': 'Partial coverage', 'telemetry.status.missing': 'No telemetry available', 'telemetry.status.unsupported': 'Unsupported source',
      'telemetry.source.codex_rollout': 'Source: Codex rollout', 'telemetry.source.other': 'Source: other',
      'telemetry.coverage': 'Coverage', 'telemetry.threads': 'Threads', 'telemetry.observed_threads': 'Observed', 'telemetry.partial_threads': 'Partial', 'telemetry.unsupported_threads': 'Unsupported',
      'telemetry.taskSelector': 'Task snapshot', 'telemetry.allTasks': 'All tasks', 'telemetry.selectedExcludesUnassigned': 'Only exact task attribution is shown; unassigned usage is excluded.',
      'telemetry.input': 'Input tokens', 'telemetry.cached_input': 'Cached input tokens', 'telemetry.output': 'Output tokens', 'telemetry.reasoning_output': 'Reasoning output tokens', 'telemetry.processed': 'Processed tokens',
      'telemetry.responses': 'Responses', 'telemetry.tool_calls': 'Tool calls', 'telemetry.unattributed': 'Unattributed tokens', 'telemetry.unattributedFraction': 'Unattributed share',
      'telemetry.roles': 'Roles', 'telemetry.agents': 'Agents', 'telemetry.largestToolOutputs': 'Largest tool outputs', 'telemetry.count': 'Count', 'telemetry.totalBytes': 'Total bytes', 'telemetry.medianBytes': 'Median bytes', 'telemetry.p95Bytes': 'P95 bytes', 'telemetry.maxBytes': 'Max bytes',
      'telemetry.spawns': 'Spawns', 'telemetry.attempts': 'Attempts', 'telemetry.confirmed': 'Confirmed', 'telemetry.compactions': 'Compactions', 'telemetry.start_at': 'Start', 'telemetry.end_at': 'End', 'telemetry.elapsed_ms': 'Elapsed (ms)',
      'common.none': 'none', 'common.unknown': 'unknown', 'common.inherited': 'inherited',
      'dashboard.noGoal': 'No active goal', 'dashboard.noTask': 'no task', 'dashboard.unassigned': 'unassigned',
      'dashboard.unavailable': 'Dashboard unavailable: {message}',
      'task.add': 'Add task', 'task.edit': 'Edit', 'task.save': 'Save', 'task.cancel': 'Cancel',
      'task.reload': 'Reload current', 'task.retry': 'Retry', 'task.oldest': 'Oldest first', 'task.newest': 'Newest first',
      'task.title': 'Title', 'task.status': 'Status', 'task.branch': 'Branch', 'task.owner': 'Owner', 'task.created': 'Created', 'task.updated': 'Updated',
      'task.invalidTitle': 'Enter a title of at most 300 characters.', 'task.invalidBranch': 'Enter a branch label of at most 120 characters without control characters.',
      'task.conflict': 'This task changed. Your draft is retained; reload the current version or cancel.',
      'task.saveFailed': 'Save failed. Your draft is retained.', 'task.networkError': 'Network error. Your draft is retained; retry when ready.',
      'task.status.pending': 'Pending', 'task.status.in_progress': 'In progress', 'task.status.blocked': 'Blocked',
      'task.status.completed': 'Completed', 'task.status.cancelled': 'Cancelled',
      'dashboard.futureStart': 'future start',
      'dashboard.reportedRunning': 'reported running', 'dashboard.startedRecent': 'started/resumed within past hour; liveness unconfirmed',
      'dashboard.startedOutside': 'not started/resumed within past hour; liveness unconfirmed',
      'dashboard.agentCount': 'Reported running: {reported}; started/resumed within past hour: {recent}; outside past hour or unknown start: {outside}. No live liveness check.',
      'catalog.agentTitle': 'Agent Catalog', 'catalog.skillTitle': 'Skill Catalog',
      'catalog.detail': 'Read-only details discovered from repository source files.',
      'catalog.empty': 'No catalog entries found.', 'catalog.noDescription': 'No description.',
      'catalog.path': 'Path: {path}', 'catalog.preferred': 'Preferred: {model} · {reasoning}',
      'catalog.fallback': 'Fallback: {value}', 'catalog.currentFile': 'Current file',
      'catalog.sourceUnavailable': 'Source unavailable.',
      'preview.title': 'Preview Lab',
      'preview.detail': 'Review multiple screens, routes, and UI states in one large read-only workspace.',
      'preview.planSpecs': 'Plan / Task Specs', 'preview.uiArtifacts': 'UI Artifacts',
      'preview.unavailable': 'Preview Lab unavailable: {message}',
      'guide.title': 'Harness Guide', 'guide.detail': 'v1.1.1 commands and workflow.',
      'guide.body': '<h2>Quick start</h2><p>Install the neutral engine separately from the selected project checkout. Declare the project management paths and an ignored local binding. Verify the explicit binding before stateful commands; do not guess a default project.</p><pre>npm test\nnpm run self-check\nnode scripts/project-diagnostic.mjs --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt; --project &lt;project-id&gt;</pre><p>In this staged neutral engine, init, status, watchdog, preview, and preview:live require --project, --checkout, and --binding. Status can initialize missing runtime files; watchdog records warnings and events.</p><pre>npm run status -- --project &lt;project-id&gt; --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt;\nnpm run preview:live -- --project &lt;project-id&gt; --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt;</pre><h2>Staged local installation</h2><p>Keep engine source, installation, and project checkout separate. Use selected-project management paths for Task Specs, memory, and runtime. Preserve existing runtime, Task Specs, memory, claims, and sessions. Migration requires separate review, backup, and rollback evidence. The project cutover gate remains closed; tests alone do not authorize a cutover.</p><h2>Four-target role generator: staged only</h2><p>Canonical neutral roles live in <code>harness/agents/</code>. Codex, Claude Code, OpenCode, and Antigravity adapters render candidates; they are not a proven four-tool distribution. All four native smoke states are unverified. Normal sync writes are blocked until target native smoke, skill discovery, ownership, and review gates pass.</p><pre>node scripts/detect-targets.mjs --json\nnode scripts/validate.mjs --targets codex --profile core --json\nnode scripts/sync.mjs --targets codex --profile core --dry-run\nnode scripts/sync.mjs --targets codex --profile core --check</pre><p>Detection, validation, dry-run, and check inspect without writing generated roles. Validation and check can exit nonzero for honest missing-manifest and native-smoke gates. Do not run normal <code>node scripts/sync.mjs --targets codex --profile core</code> against this checkout merely to clear reports. Targets may be a supported ID, a comma-separated subset, or all; profiles are core or all.</p><h2>Preview and plans</h2><p>The source guide is <code>preview/index.html</code>; open the URL printed by preview:live with <code>#guide</code>, not file://. A validated selected project supplies runtime and Task Specs. <code>npm run preview -- --project &lt;project-id&gt; --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt;</code> writes one static snapshot to the selected runtime; it does not refresh. The live server initializes the selected runtime and refreshes while running. Preview Lab is read-only; ask Codex to change plans. UI artifacts may be registered as route, hash, or query-string tabs.</p><h2>Role flow and verification</h2><p>SMALL: Worker and proportionate checks. MEDIUM: Planner → Worker → Verifier → Reviewer when independence adds value. LARGE: add impact analysis, isolated workers, integration, and supervisor checkpoints as needed. Worker implements and tests; Verifier independently reruns; Reviewer examines correctness, regressions, scope, and evidence. SubagentStop is not success.</p><h2>Watchdog and claims</h2><p>Watchdog records deterministic anomalies; Supervisor is an on-demand read-only audit, not a daemon. Claim non-overlapping scopes: <code>src/backend/</code> and <code>src/frontend/</code> can run together, while <code>src/</code> conflicts with <code>src/backend/</code>. Use sequential execution or worktree isolation on conflict.</p><h2>Model policy</h2><p>Main is user-selected/inherited. Sol handles implementation and complex judgment; Luna handles verification, research, and repetitive work. Astra is exceptional manual escalation only. Role settings live in <code>.codex/config.toml</code> and <code>.codex/agents/</code>. A supported native spawn override may retry once with the matching GPT-5.6 role model only after an explicit GPT-6 model-unavailable error; ordinary task, test, tool, and timeout failures do not route models.</p>',
      'guide.networkBody': '<h2>Using the Agent Signal Network</h2><p>Reported Running Agents lists reported-running records, not confirmed liveness; Agent Signal Network shows recorded relationships and workflow; Signal Timeline shows the latest ten stored signals, newest first; Preview Lab shows result UI and artifacts. On the refreshing Dashboard, select an agent or signal for details and use Reported running only/Full history, task and failure filters, pan, zoom, Fit, and Reset. Edges come only from recorded signals.</p><pre>Selected project: npm run preview:live -- --project &lt;project-id&gt; --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt;\nIsolated demo: npm run demo:network\nAfter stopping demo: npm run demo:reset</pre><p>Open the URL printed by either server. Demo startup replaces fixture data under <code>.ai/demo/network-runtime</code>; reset removes exactly that demo directory and leaves selected-project runtime alone. <code>npm run preview -- --project &lt;project-id&gt; --checkout &lt;absolute-checkout&gt; --binding &lt;absolute-binding&gt;</code> saves a static network labeled Snapshot History with snapshot-based filters; it does not poll. See README, Agent Signal Network, for the full workflow.</p>',
      'artifacts.empty': 'No UI artifacts registered.', 'artifacts.tabsLabel': 'UI artifact previews',
      'artifacts.refresh': 'Refresh', 'artifacts.open': 'Open separately',
      'artifacts.externalBlocked': 'This URL is not embedded by the Preview Lab safety policy. Use Open separately to inspect it.',
      'artifacts.schemeBlocked': 'This URL scheme is not supported by the Preview Lab safety policy.',
      'network.modeLabel': 'Network mode', 'network.live': 'Reported running only', 'network.history': 'Full history',
      'network.snapshotHistory': 'Snapshot History', 'network.filterLabel': 'Network filter', 'network.all': 'All',
      'network.active': 'Reported running', 'network.failures': 'Failures', 'network.currentTask': 'Current Task',
      'network.taskLabel': 'Network task', 'network.zoomIn': 'Zoom in', 'network.zoomOut': 'Zoom out',
      'network.fit': 'Fit', 'network.reset': 'Reset', 'network.graphLabel': 'Agent Signal Network',
      'network.empty': 'Select an agent or signal. {agents} agents, {signals} signals.',
      'network.noData': 'No agents or signals in this snapshot.',
      'network.noActive': 'No agents reported running in this snapshot. Switch to Full history for retained records.',
      'network.observed': 'Runtime records report {agents} as running. No live liveness check; last snapshot update: {time}. This is not the full native agent list.',
      'network.reportedRunning': 'reported running; liveness unconfirmed',
      'network.noTaskData': 'No linked network data for the selected task.',
      'network.historyNote': 'History includes only agents and signals retained in this runtime.',
      'network.agent': 'Agent', 'network.role': 'Role', 'network.status': 'Status', 'network.model': 'Model',
      'network.reasoning': 'Reasoning', 'network.currentLastTask': 'Current/Last Task', 'network.started': 'Started',
      'network.finished': 'Finished', 'network.claims': 'Claims', 'network.inbound': 'Inbound Signals',
      'network.outbound': 'Outbound Signals', 'network.elapsed': 'Elapsed', 'network.from': 'From', 'network.to': 'To',
      'network.kind': 'Kind', 'network.summary': 'Summary', 'network.sent': 'Sent', 'network.task': 'Task',
      'network.artifact': 'Artifact', 'network.verification': 'Verification', 'network.edgeLabel': '{from} to {to}: {kind}',
      'static.title': 'Pure Harness snapshot', 'static.generated': 'Static snapshot generated {time}',
      'static.phase': 'Phase: {phase}'
    },
    ko: {
      'preferences.language': 'English',
      'preferences.languageLabel': '언어를 영어로 변경',
      'preferences.light': '밝게',
      'preferences.lightLabel': '밝은 테마로 변경',
      'preferences.dark': '어둡게',
      'preferences.darkLabel': '어두운 테마로 변경',
      'dashboard.title': '실시간 대시보드',
      'dashboard.detail': '현재 runtime 상태를 확인하는 선택적 localhost 화면입니다.',
      'app.tagline': 'Codex 네이티브 워크플로',
      'nav.dashboard': '실시간 대시보드', 'nav.preview': '미리보기 랩', 'nav.agents': '에이전트 카탈로그',
      'nav.skills': '스킬 카탈로그', 'nav.guide': 'Harness 가이드',
      'sidebar.note': '실시간 데이터는 3초마다 갱신됩니다. 카탈로그 정보는 저장소 설정에서 읽습니다.',
      'section.goal': '목표', 'section.phase': '단계', 'section.activeAgents': '실행 중 기록 에이전트',
      'section.verification': '검증', 'section.tasks': '작업', 'section.claims': '쓰기 점유',
      'section.warnings': 'Watchdog 경고', 'section.blockers': '차단 요소', 'section.signals': '신호 타임라인',
      'section.network': '에이전트 신호 네트워크', 'section.events': '최근 이벤트', 'section.artifacts': '아티팩트',
      'section.telemetry': '토큰 관측',
      'telemetry.unknown': '알 수 없음', 'telemetry.stale': '오래된 값 — 읽기에 실패하여 마지막 결과를 표시합니다.',
      'telemetry.status.observed': '관측됨', 'telemetry.status.partial': '부분 관측', 'telemetry.status.missing': '관측 데이터 없음', 'telemetry.status.unsupported': '지원되지 않는 소스',
      'telemetry.source.codex_rollout': '소스: Codex 롤아웃', 'telemetry.source.other': '소스: 기타',
      'telemetry.coverage': '관측 범위', 'telemetry.threads': '스레드', 'telemetry.observed_threads': '관측됨', 'telemetry.partial_threads': '부분', 'telemetry.unsupported_threads': '미지원',
      'telemetry.taskSelector': '작업 스냅샷', 'telemetry.allTasks': '모든 작업', 'telemetry.selectedExcludesUnassigned': '정확히 귀속된 작업 사용량만 표시합니다. 미귀속 사용량은 제외됩니다.',
      'telemetry.input': '입력 토큰', 'telemetry.cached_input': '캐시 입력 토큰', 'telemetry.output': '출력 토큰', 'telemetry.reasoning_output': '추론 출력 토큰', 'telemetry.processed': '처리 토큰',
      'telemetry.responses': '응답', 'telemetry.tool_calls': '도구 호출', 'telemetry.unattributed': '미귀속 토큰', 'telemetry.unattributedFraction': '미귀속 비율',
      'telemetry.roles': '역할', 'telemetry.agents': '에이전트', 'telemetry.largestToolOutputs': '최대 도구 출력', 'telemetry.count': '횟수', 'telemetry.totalBytes': '총 바이트', 'telemetry.medianBytes': '중앙값 바이트', 'telemetry.p95Bytes': 'P95 바이트', 'telemetry.maxBytes': '최대 바이트',
      'telemetry.spawns': '스폰', 'telemetry.attempts': '시도', 'telemetry.confirmed': '확인됨', 'telemetry.compactions': '압축', 'telemetry.start_at': '시작', 'telemetry.end_at': '종료', 'telemetry.elapsed_ms': '경과 (밀리초)',
      'common.none': '없음', 'common.unknown': '알 수 없음', 'common.inherited': '상속됨',
      'dashboard.noGoal': '활성 목표 없음', 'dashboard.noTask': '작업 없음', 'dashboard.unassigned': '미할당',
      'dashboard.unavailable': '대시보드를 사용할 수 없습니다: {message}',
      'task.add': '작업 추가', 'task.edit': '편집', 'task.save': '저장', 'task.cancel': '취소',
      'task.reload': '현재 버전 다시 불러오기', 'task.retry': '재시도', 'task.oldest': '오래된 순', 'task.newest': '최신 순',
      'task.title': '제목', 'task.status': '상태', 'task.branch': '브랜치', 'task.owner': '담당자', 'task.created': '생성', 'task.updated': '수정',
      'task.invalidTitle': '300자 이하의 제목을 입력하세요.', 'task.invalidBranch': '제어 문자가 없는 120자 이하의 브랜치 이름을 입력하세요.',
      'task.conflict': '이 작업이 변경되었습니다. 초안은 보존됩니다. 현재 버전을 다시 불러오거나 취소하세요.',
      'task.saveFailed': '저장에 실패했습니다. 초안은 보존됩니다.', 'task.networkError': '네트워크 오류입니다. 초안은 보존됩니다. 준비되면 재시도하세요.',
      'task.status.pending': '대기', 'task.status.in_progress': '진행 중', 'task.status.blocked': '차단됨',
      'task.status.completed': '완료', 'task.status.cancelled': '취소됨',
      'dashboard.futureStart': '미래 시작 시각',
      'dashboard.reportedRunning': '실행 중으로 기록됨', 'dashboard.startedRecent': '지난 1시간 내 시작/재개 · 생존 여부 미확인',
      'dashboard.startedOutside': '지난 1시간 내 시작/재개 기록 없음 · 생존 여부 미확인',
      'dashboard.agentCount': '실행 중 기록 {reported}명 · 지난 1시간 내 시작/재개 {recent}명 · 해당 기간 밖 또는 시작 시각 미상 {outside}명. 실시간 생존 확인 기능은 없습니다.',
      'catalog.agentTitle': '에이전트 카탈로그', 'catalog.skillTitle': '스킬 카탈로그',
      'catalog.detail': '저장소 소스 파일에서 찾은 읽기 전용 상세 정보입니다.',
      'catalog.empty': '카탈로그 항목이 없습니다.', 'catalog.noDescription': '설명이 없습니다.',
      'catalog.path': '경로: {path}', 'catalog.preferred': '선호 설정: {model} · {reasoning}',
      'catalog.fallback': '대체 설정: {value}', 'catalog.currentFile': '현재 파일',
      'catalog.sourceUnavailable': '소스를 사용할 수 없습니다.',
      'preview.title': '미리보기 랩',
      'preview.detail': '여러 화면, route, UI 상태를 넓은 읽기 전용 작업 공간에서 검토합니다.',
      'preview.planSpecs': '계획 / 작업 명세', 'preview.uiArtifacts': 'UI 아티팩트',
      'preview.unavailable': '미리보기 랩을 사용할 수 없습니다: {message}',
      'guide.title': 'Harness 가이드', 'guide.detail': 'v1.1.1 명령과 워크플로입니다.',
      'guide.body': '<h2>빠른 시작</h2><p>중립 엔진은 선택 프로젝트 checkout과 별도로 설치합니다. 프로젝트 관리 경로와 추적하지 않는 로컬 binding을 선언하고 상태 변경 명령 전에 명시적으로 검증하세요. 기본 프로젝트를 추측하지 않습니다.</p><pre>npm test\nnpm run self-check\nnode scripts/project-diagnostic.mjs --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt; --project &lt;프로젝트-id&gt;</pre><p>이 단계적 중립 엔진의 init, status, watchdog, preview, preview:live에는 --project, --checkout, --binding이 필요합니다. status는 누락된 runtime 파일을 만들 수 있고 watchdog는 경고와 이벤트를 기록합니다.</p><pre>npm run status -- --project &lt;프로젝트-id&gt; --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt;\nnpm run preview:live -- --project &lt;프로젝트-id&gt; --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt;</pre><h2>단계적 로컬 설치</h2><p>엔진 소스, 설치 공간, 프로젝트 checkout을 분리합니다. 작업 명세, 메모리, runtime은 선택 프로젝트의 관리 경로에 두세요. 기존 runtime, 작업 명세, 메모리, 점유, 세션을 보존합니다. 이관에는 별도 검토, 백업, 롤백 근거가 필요합니다. 프로젝트 전환 게이트는 아직 닫혀 있으며 테스트 성공만으로 전환할 수 없습니다.</p><h2>네 도구용 역할 생성기: 단계적 후보</h2><p>중립 정본 역할은 <code>harness/agents/</code>에 있습니다. Codex, Claude Code, OpenCode, Antigravity 어댑터가 후보를 렌더링하지만 네 도구에서 사용 가능한 배포물은 아닙니다. 네 대상 모두 native smoke가 미검증입니다. 일반 sync 쓰기는 대상의 native smoke, Skill 탐색, 소유권, 검토 게이트가 충족되어야 합니다.</p><pre>node scripts/detect-targets.mjs --json\nnode scripts/validate.mjs --targets codex --profile core --json\nnode scripts/sync.mjs --targets codex --profile core --dry-run\nnode scripts/sync.mjs --targets codex --profile core --check</pre><p>탐색, 검증, dry-run, check는 생성 역할을 쓰지 않습니다. validate와 check는 manifest 누락과 미검증 native smoke를 정직하게 보고하며 0이 아닌 종료 상태일 수 있습니다. 보고를 없애려고 이 checkout에서 일반 <code>node scripts/sync.mjs --targets codex --profile core</code>를 실행하지 마세요. 대상은 지원 ID, 쉼표로 구분한 부분집합 또는 all이고 profile은 core 또는 all입니다.</p><h2>미리보기와 계획</h2><p>가이드 소스는 <code>preview/index.html</code>입니다. preview:live가 출력한 URL에 <code>#guide</code>를 붙여 열고 file://로 직접 열지 마세요. 검증된 선택 프로젝트의 runtime과 작업 명세를 사용합니다. <code>npm run preview -- --project &lt;프로젝트-id&gt; --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt;</code>는 선택 runtime에 정적 스냅샷을 한 번 쓰며 갱신하지 않습니다. 실시간 서버는 선택 runtime을 초기화하고 실행 중 갱신합니다. 미리보기 랩은 읽기 전용이며 계획 수정은 Codex에 요청하세요. UI 아티팩트는 route, hash, query-string별 탭으로 등록할 수 있습니다.</p><h2>역할 흐름과 검증</h2><p>SMALL: Worker와 범위에 맞는 검사. MEDIUM: 독립성이 유용할 때 Planner → Worker → Verifier → Reviewer. LARGE: 필요에 따라 영향 분석, 격리된 Worker, 통합, Supervisor 점검을 추가합니다. Worker는 구현·테스트, Verifier는 독립 재실행, Reviewer는 정확성·회귀·범위·근거를 평가합니다. SubagentStop은 성공을 뜻하지 않습니다.</p><h2>Watchdog와 점유</h2><p>Watchdog는 결정론적 이상을 기록합니다. Supervisor는 상주 daemon이 아닌 요청 시 읽기 전용 점검 역할입니다. 겹치지 않는 범위를 점유하세요. <code>src/backend/</code>와 <code>src/frontend/</code>는 함께 작업할 수 있지만 <code>src/</code>와 <code>src/backend/</code>는 충돌합니다. 충돌하면 순차 실행하거나 worktree로 격리하세요.</p><h2>모델 정책</h2><p>Main 모델은 사용자 선택 또는 상속입니다. Sol은 구현과 복잡한 판단, Luna는 검증·조사·반복 작업을 담당합니다. Astra는 예외적인 수동 상향 전용입니다. 역할 설정은 <code>.codex/config.toml</code>과 <code>.codex/agents/</code>에 있습니다. 지원되는 native spawn override는 명시적 GPT-6 모델 사용 불가 오류 뒤에만 대응 GPT-5.6 역할 모델로 한 번 재시도할 수 있습니다. 일반 작업·테스트·도구·timeout 실패는 모델 대체 조건이 아닙니다.</p>',
      'guide.networkBody': '<h2>에이전트 신호 네트워크 사용법</h2><p>실행 중 기록 에이전트는 런타임에 실행 중으로 표시된 기록이며 생존 여부를 확인하지 않습니다. 에이전트 신호 네트워크는 기록된 관계와 흐름을, 신호 타임라인은 최신 저장 신호 10개를, 미리보기 랩은 결과 UI와 아티팩트를 보여줍니다. 갱신되는 대시보드에서 에이전트나 신호를 선택해 상세 정보를 보고 실행 중 기록만/전체 기록, 작업·실패 필터, 이동, 확대·축소, 맞춤, 초기화를 사용할 수 있습니다. edge는 실제 저장된 신호만 표시합니다.</p><pre>선택 프로젝트: npm run preview:live -- --project &lt;프로젝트-id&gt; --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt;\n격리된 데모: npm run demo:network\n데모 종료 후: npm run demo:reset</pre><p>서버가 출력한 URL을 여세요. 데모 시작 시 <code>.ai/demo/network-runtime</code>의 fixture 데이터를 교체하고 reset은 정확히 그 데모 디렉터리만 제거합니다. 선택 프로젝트 runtime은 건드리지 않습니다. <code>npm run preview -- --project &lt;프로젝트-id&gt; --checkout &lt;checkout-절대경로&gt; --binding &lt;binding-절대경로&gt;</code>는 snapshot 기반 필터를 제공하는 정적 네트워크를 저장하며 polling하지 않습니다.</p>',
      'artifacts.empty': '등록된 UI 아티팩트가 없습니다.', 'artifacts.tabsLabel': 'UI 아티팩트 미리보기',
      'artifacts.refresh': '새로 고침', 'artifacts.open': '새 탭에서 열기',
      'artifacts.externalBlocked': '미리보기 랩 안전 정책에 따라 이 URL을 삽입하지 않습니다. 새 탭에서 열어 확인하세요.',
      'artifacts.schemeBlocked': '미리보기 랩 안전 정책에서 지원하지 않는 URL 형식입니다.',
      'network.modeLabel': '네트워크 모드', 'network.live': '실행 중 기록만', 'network.history': '전체 기록',
      'network.snapshotHistory': 'Snapshot 기록', 'network.filterLabel': '네트워크 필터', 'network.all': '전체',
      'network.active': '실행 중 기록', 'network.failures': '실패', 'network.currentTask': '현재 작업',
      'network.taskLabel': '네트워크 작업', 'network.zoomIn': '확대', 'network.zoomOut': '축소',
      'network.fit': '맞춤', 'network.reset': '초기화', 'network.graphLabel': '에이전트 신호 네트워크',
      'network.empty': '에이전트 또는 신호를 선택하세요. 에이전트 {agents}개, 신호 {signals}개.',
      'network.noData': '이 snapshot에는 에이전트나 신호가 없습니다.',
      'network.noActive': '이 스냅샷에는 실행 중으로 기록된 에이전트가 없습니다. 보존된 기록을 보려면 전체 기록으로 전환하세요.',
      'network.observed': '런타임 기록에 실행 중으로 표시된 에이전트 {agents}명 · 생존 여부 미확인 · 마지막 스냅샷 갱신: {time}. Codex 앱의 전체 에이전트 목록은 아닙니다.',
      'network.reportedRunning': '실행 중 기록 · 생존 여부 미확인',
      'network.noTaskData': '선택한 작업에 연결된 네트워크 데이터가 없습니다.',
      'network.historyNote': '이 기록은 현재 runtime에 보존된 에이전트와 신호만 포함합니다.',
      'network.agent': '에이전트', 'network.role': '역할', 'network.status': '상태', 'network.model': '모델',
      'network.reasoning': '추론 수준', 'network.currentLastTask': '현재/마지막 작업', 'network.started': '시작',
      'network.finished': '종료', 'network.claims': '점유', 'network.inbound': '수신 신호',
      'network.outbound': '발신 신호', 'network.elapsed': '경과', 'network.from': '보낸 이', 'network.to': '받는 이',
      'network.kind': '종류', 'network.summary': '요약', 'network.sent': '전송 시각', 'network.task': '작업',
      'network.artifact': '아티팩트', 'network.verification': '검증', 'network.edgeLabel': '{from}에서 {to}로: {kind}',
      'static.title': 'Pure Harness snapshot', 'static.generated': '정적 snapshot 생성 시각: {time}',
      'static.phase': '단계: {phase}'
    }
  };

  const read = (storage, key) => {
    try { return storage?.getItem(key); } catch { return null; }
  };
  const write = (storage, key, value) => {
    try { storage?.setItem(key, value); } catch { /* Preferences remain usable without storage. */ }
  };
  const interpolate = (message, values) => String(message).replace(/\{([^}]+)\}/g, (_match, key) => String(values?.[key] ?? ''));

  function create(document, options = {}) {
    let storage = options.storage;
    if (storage === undefined) {
      try { storage = global.localStorage; } catch { storage = null; }
    }
    let locale = ['en', 'ko'].includes(read(storage, STORAGE.locale)) ? read(storage, STORAGE.locale) : 'en';
    let theme = ['dark', 'light'].includes(read(storage, STORAGE.theme)) ? read(storage, STORAGE.theme) : 'dark';
    const listeners = new Set();
    const mounts = new Set();
    const t = (key, values) => interpolate(messages[locale]?.[key] ?? messages.en[key] ?? key, values);

    function apply() {
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style?.setProperty?.('color-scheme', theme);
      translate(document);
    }
    function translate(root = document) {
      root.querySelectorAll?.('[data-i18n]').forEach(node => {
        let values = {};
        try { values = JSON.parse(node.getAttribute('data-i18n-values') || '{}'); } catch { values = {}; }
        node.textContent = t(node.getAttribute('data-i18n'), values);
      });
      root.querySelectorAll?.('[data-i18n-aria-label]').forEach(node => {
        node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
      });
    }
    function draw(host) {
      const language = document.createElement('button');
      language.type = 'button';
      language.className = 'preference-button';
      language.dataset.preferenceAction = 'language';
      language.textContent = t('preferences.language');
      language.setAttribute('aria-label', t('preferences.languageLabel'));
      language.onclick = () => setLocale(locale === 'en' ? 'ko' : 'en');
      const themeButton = document.createElement('button');
      themeButton.type = 'button';
      themeButton.className = 'preference-button';
      themeButton.dataset.preferenceAction = 'theme';
      const themeKey = theme === 'dark' ? 'light' : 'dark';
      themeButton.textContent = t(`preferences.${themeKey}`);
      themeButton.setAttribute('aria-label', t(`preferences.${themeKey}Label`));
      themeButton.onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
      host.replaceChildren(language, themeButton);
    }
    function notify() {
      apply();
      mounts.forEach(draw);
      listeners.forEach(listener => listener({ locale, theme }));
    }
    function setLocale(value) {
      if (!['en', 'ko'].includes(value) || value === locale) return;
      locale = value;
      write(storage, STORAGE.locale, locale);
      notify();
    }
    function setTheme(value) {
      if (!['dark', 'light'].includes(value) || value === theme) return;
      theme = value;
      write(storage, STORAGE.theme, theme);
      notify();
    }
    function mount(host) { mounts.add(host); draw(host); }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }

    apply();
    return {
      get locale() { return locale; },
      get theme() { return theme; },
      t,
      mount,
      translate,
      subscribe,
      setLocale,
      setTheme
    };
  }

  global.PreviewPreferences = { create };
})(globalThis);
