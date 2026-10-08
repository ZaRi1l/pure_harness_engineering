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
      'dashboard.tabs.overview': 'Overview', 'dashboard.tabs.tasks': 'Tasks', 'dashboard.tabs.agents': 'Agents', 'dashboard.tabs.telemetry': 'Telemetry',
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
      'telemetry.unknown': 'Unknown', 'telemetry.stale': 'Stale — telemetry read failed; showing the last result.', 'telemetry.unavailable': 'Telemetry unavailable — the read failed.',
      'telemetry.status.observed': 'Observed', 'telemetry.status.partial': 'Partial coverage', 'telemetry.status.missing': 'No telemetry available', 'telemetry.status.unsupported': 'Unsupported source',
      'telemetry.source.codex_rollout': 'Source: Codex rollout', 'telemetry.source.other': 'Source: other',
      'telemetry.coverage': 'Coverage', 'telemetry.threads': 'Threads', 'telemetry.observed_threads': 'Observed', 'telemetry.partial_threads': 'Partial', 'telemetry.unsupported_threads': 'Unsupported',
      'telemetry.taskSelector': 'Task snapshot', 'telemetry.allTasks': 'All tasks', 'telemetry.selectedExcludesUnassigned': 'Only exact task attribution is shown; unassigned usage is excluded.',
      'telemetry.input': 'Input tokens', 'telemetry.cached_input': 'Cached input tokens', 'telemetry.output': 'Output tokens', 'telemetry.reasoning_output': 'Reasoning output tokens', 'telemetry.processed': 'Processed tokens',
      'telemetry.responses': 'Responses', 'telemetry.tool_calls': 'Tool calls', 'telemetry.unattributed': 'Unattributed tokens', 'telemetry.unattributedFraction': 'Unattributed share',
      'telemetry.roles': 'Roles', 'telemetry.agents': 'Agents', 'telemetry.largestToolOutputs': 'Largest tool outputs', 'telemetry.count': 'Count', 'telemetry.totalBytes': 'Total bytes', 'telemetry.medianBytes': 'Median bytes', 'telemetry.p95Bytes': 'P95 bytes', 'telemetry.maxBytes': 'Max bytes',
      'telemetry.toolOutputsMeasured': 'Measured text outputs', 'telemetry.toolOutputsUnmeasured': 'Unmeasured/unsupported outputs', 'telemetry.toolOutputTextOnly': 'Output coverage counts all parsed tool calls independently of token status. Byte rankings include text-only measured outputs from token-observed threads.',
      'telemetry.spawns': 'Spawns', 'telemetry.attempts': 'Attempts', 'telemetry.confirmed': 'Confirmed', 'telemetry.compactions': 'Compactions', 'telemetry.start_at': 'Start', 'telemetry.end_at': 'End', 'telemetry.elapsed_ms': 'Elapsed (ms)',
      'common.none': 'none', 'common.unknown': 'unknown', 'common.inherited': 'inherited',
      'dashboard.noGoal': 'No active goal', 'dashboard.noTask': 'no task', 'dashboard.unassigned': 'unassigned',
      'dashboard.unavailable': 'Dashboard unavailable. The latest snapshot could not be loaded.',
      'task.fetchFailed': 'Tasks unavailable. The latest task list could not be loaded.',
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
      'preview.unavailable': 'Preview Lab unavailable. Task specs or artifacts could not be loaded.',
      'guide.title': 'Harness Guide', 'guide.detail': 'v1.1.1 commands and workflow.',
      'guide.choose': 'What would you like to do?',
      'guide.note': 'The dashboard shows records for this Harness installation\'s fixed project. AI tool files are selected during setup.',
      'guide.choice.new': 'Start a new project', 'guide.choice.existing': 'Try an existing project safely', 'guide.choice.connected': 'Open an already connected project',
      'guide.new.body': 'Run setup from the Harness folder and choose a new project and AI tool. Review the plan and confirm its displayed apply phrase. Setup creates the separate child Git in project/. Run init once, then status and the live preview.',
      'guide.new.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
      'guide.existing.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
      'guide.existing.body': 'Keep the original project and runtime untouched. For a local Git source, review the file inventory, conflicts, and AI target before applying; history and working files are copied into project/, not moved. A remote plan pins HEAD but its files are not inspected yet. If cloning reveals a new conflict, Apply stops before publishing; use a local checkout for full review. Do not delete or reset the original.',
      'guide.connected.body': 'For the already configured fixed project, run status and the live preview from the Harness folder. Open the localhost URL printed by the server. Use setup to review an AI target update; do not run init again.',
      'guide.connected.commands': 'npm run status\nnpm run preview:live',
      'guide.advanced': 'Advanced setup and workflow reference', 'guide.networkAdvanced': 'Agent network reference',
      'guide.body': '<h2>Quick start</h2><p>One Harness installation manages one independent Git child at <code>project/</code>; ignored installation and runtime state lives in <code>.harness/</code>. Run interactive setup for a new or existing source, select an AI target, review the plan, and confirm the displayed apply phrase.</p><pre>npm run setup\nnpm run init\nnpm run status\nnpm run preview:live</pre><p>Run init only once. For an existing local source, setup copies Git history and working files without moving the original. Conflicts stop before overwrite. Open the localhost URL printed by preview:live with #guide; file:// is not supported.</p><h2>AI tool verification</h2><p>Setup/update plans manage Codex, Claude Code, OpenCode, and Antigravity files. Generated files alone do not prove native role or Skill discovery, permissions, or hook delivery. The older candidate export and normal sync path retain separate gates; do not use sync to bypass them.</p><h2>More detail</h2><p>Read docs/first-use.md and docs/setup-reference.md for source preservation, planning, troubleshooting, and validation limits. Preview Lab reads recorded artifacts; agent signals report recorded events rather than guaranteed liveness or success.</p>',
      'guide.networkBody': '<h2>Using the Agent Signal Network</h2><p>Reported Running Agents lists reported-running records, not confirmed liveness; Agent Signal Network shows recorded relationships and workflow; Signal Timeline shows the latest ten stored signals, newest first; Preview Lab shows result UI and artifacts. On the refreshing Dashboard, select an agent or signal for details and use Reported running only/Full history, task and failure filters, pan, zoom, Fit, and Reset. Edges come only from recorded signals.</p><pre>Selected project: npm run preview:live\nIsolated demo: npm run demo:network\nAfter stopping demo: npm run demo:reset</pre><p>Open the URL printed by either server. Demo startup replaces fixture data under <code>.ai/demo/network-runtime</code>; reset removes exactly that demo directory and leaves selected-project runtime alone. <code>npm run preview</code> saves a static network labeled Snapshot History with snapshot-based filters; it does not poll. See README, Agent Signal Network, for the full workflow.</p>',
      'artifacts.empty': 'No UI artifacts registered.', 'artifacts.tabsLabel': 'UI artifact previews',
      'artifacts.refresh': 'Refresh', 'artifacts.open': 'Open separately',
      'artifacts.externalBlocked': 'This URL is not embedded by the Preview Lab safety policy. Use Open separately to inspect it.',
      'artifacts.schemeBlocked': 'This URL scheme is not supported by the Preview Lab safety policy.',
      'artifacts.credentialsBlocked': 'URLs containing credentials cannot be opened by the Preview Lab.',
      'artifacts.urlHidden': 'URL hidden for safety',
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
      'dashboard.tabs.overview': '개요', 'dashboard.tabs.tasks': '작업', 'dashboard.tabs.agents': '에이전트', 'dashboard.tabs.telemetry': '토큰 현황',
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
      'telemetry.unknown': '알 수 없음', 'telemetry.stale': '오래된 값 — 읽기에 실패하여 마지막 결과를 표시합니다.', 'telemetry.unavailable': '토큰 관측 데이터를 읽지 못했습니다.',
      'telemetry.status.observed': '관측됨', 'telemetry.status.partial': '부분 관측', 'telemetry.status.missing': '관측 데이터 없음', 'telemetry.status.unsupported': '지원되지 않는 소스',
      'telemetry.source.codex_rollout': '소스: Codex 롤아웃', 'telemetry.source.other': '소스: 기타',
      'telemetry.coverage': '관측 범위', 'telemetry.threads': '스레드', 'telemetry.observed_threads': '관측됨', 'telemetry.partial_threads': '부분', 'telemetry.unsupported_threads': '미지원',
      'telemetry.taskSelector': '작업 스냅샷', 'telemetry.allTasks': '모든 작업', 'telemetry.selectedExcludesUnassigned': '정확히 귀속된 작업 사용량만 표시합니다. 미귀속 사용량은 제외됩니다.',
      'telemetry.input': '입력 토큰', 'telemetry.cached_input': '캐시 입력 토큰', 'telemetry.output': '출력 토큰', 'telemetry.reasoning_output': '추론 출력 토큰', 'telemetry.processed': '처리 토큰',
      'telemetry.responses': '응답', 'telemetry.tool_calls': '도구 호출', 'telemetry.unattributed': '미귀속 토큰', 'telemetry.unattributedFraction': '미귀속 비율',
      'telemetry.roles': '역할', 'telemetry.agents': '에이전트', 'telemetry.largestToolOutputs': '최대 도구 출력', 'telemetry.count': '횟수', 'telemetry.totalBytes': '총 바이트', 'telemetry.medianBytes': '중앙값 바이트', 'telemetry.p95Bytes': 'P95 바이트', 'telemetry.maxBytes': '최대 바이트',
      'telemetry.toolOutputsMeasured': '측정된 텍스트 출력', 'telemetry.toolOutputsUnmeasured': '미측정/미지원 출력', 'telemetry.toolOutputTextOnly': '출력 범위는 토큰 상태와 별개로 파싱된 모든 도구 호출을 셉니다. 바이트 순위는 토큰이 관측된 스레드의 텍스트 출력 측정값만 포함합니다.',
      'telemetry.spawns': '스폰', 'telemetry.attempts': '시도', 'telemetry.confirmed': '확인됨', 'telemetry.compactions': '압축', 'telemetry.start_at': '시작', 'telemetry.end_at': '종료', 'telemetry.elapsed_ms': '경과 (밀리초)',
      'common.none': '없음', 'common.unknown': '알 수 없음', 'common.inherited': '상속됨',
      'dashboard.noGoal': '활성 목표 없음', 'dashboard.noTask': '작업 없음', 'dashboard.unassigned': '미할당',
      'dashboard.unavailable': '대시보드를 사용할 수 없습니다. 최신 스냅샷을 불러오지 못했습니다.',
      'task.fetchFailed': '작업을 불러오지 못했습니다. 최신 작업 목록을 확인할 수 없습니다.',
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
      'preview.unavailable': '미리보기 랩을 사용할 수 없습니다. 작업 명세 또는 아티팩트를 불러오지 못했습니다.',
      'guide.title': 'Harness 가이드', 'guide.detail': 'v1.1.1 명령과 워크플로입니다.',
      'guide.choose': '무엇을 하시겠어요?',
      'guide.note': '대시보드는 이 Harness 설치의 고정 프로젝트 기록을 보여줍니다. AI 도구 파일은 설정에서 선택합니다.',
      'guide.choice.new': '새 프로젝트 시작', 'guide.choice.existing': '기존 프로젝트 안전하게 시험', 'guide.choice.connected': '이미 연결된 프로젝트 열기',
      'guide.new.body': 'Harness 폴더에서 setup을 실행해 새 프로젝트와 AI 도구를 선택하세요. 계획을 검토하고 표시된 apply 문구로 확인하면 project/에 별도 Git이 만들어집니다. init은 한 번만 실행한 뒤 상태와 실시간 미리보기를 확인하세요.',
      'guide.new.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
      'guide.existing.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
      'guide.existing.body': '원본 프로젝트와 runtime을 그대로 보존하세요. 로컬 Git 원본은 파일 목록·충돌·AI 도구를 검토한 뒤 적용하며, 커밋 기록과 작업 파일을 project/로 복사하고 원본은 이동하지 않습니다. 원격 계획은 HEAD만 고정되고 파일 목록·충돌은 미확인입니다. 복제 후 새 충돌이 나오면 게시 전에 중단하므로 로컬 checkout에서 전체 내용을 다시 검토하세요. 원본을 삭제하거나 reset하지 마세요.',
      'guide.connected.body': '이미 설정한 고정 프로젝트는 Harness 폴더에서 상태와 실시간 미리보기를 확인하세요. 서버가 출력한 localhost 주소를 엽니다. AI 도구 변경은 setup의 업데이트 계획을 검토하고, init은 다시 실행하지 마세요.',
      'guide.connected.commands': 'npm run status\nnpm run preview:live',
      'guide.advanced': '고급 설정과 워크플로 참고', 'guide.networkAdvanced': '에이전트 네트워크 참고',
      'guide.body': '<h2>빠른 시작</h2><p>Harness 설치 한 개는 별도 Git인 <code>project/</code> 하나를 관리하며, 무시되는 설치·runtime 상태는 <code>.harness/</code>에 둡니다. 새 프로젝트 또는 기존 원본을 대화형 setup에서 고르고 AI 도구와 계획을 검토한 뒤 표시된 apply 문구로 확인하세요.</p><pre>npm run setup\nnpm run init\nnpm run status\nnpm run preview:live</pre><p>init은 처음 한 번만 실행합니다. 기존 로컬 원본의 Git 기록과 작업 파일은 원본을 이동하지 않고 복사합니다. 충돌은 덮어쓰기 전에 중단합니다. preview:live가 출력한 localhost 주소에 #guide를 붙여 열고 file://로 직접 열지 마세요.</p><h2>AI 도구 검증</h2><p>설정·업데이트 계획은 Codex, Claude Code, OpenCode, Antigravity 파일을 관리합니다. 파일 생성만으로 네이티브 역할·Skill 탐색, 권한, 훅 발송이 증명되지 않습니다. 이전 후보 export와 일반 sync에는 별도 게이트가 있으며 우회하지 마세요.</p><h2>자세히</h2><p>원본 보존, 계획, 문제 해결과 검증 한계는 docs/first-use.md와 docs/setup-reference.md에 있습니다. Preview Lab은 기록된 아티팩트를 읽고, 에이전트 신호는 실제 생존·성공이 아닌 기록된 이벤트를 보여줍니다.</p>',
      'guide.networkBody': '<h2>에이전트 신호 네트워크 사용법</h2><p>실행 중 기록 에이전트는 런타임에 실행 중으로 표시된 기록이며 생존 여부를 확인하지 않습니다. 에이전트 신호 네트워크는 기록된 관계와 흐름을, 신호 타임라인은 최신 저장 신호 10개를, 미리보기 랩은 결과 UI와 아티팩트를 보여줍니다. 갱신되는 대시보드에서 에이전트나 신호를 선택해 상세 정보를 보고 실행 중 기록만/전체 기록, 작업·실패 필터, 이동, 확대·축소, 맞춤, 초기화를 사용할 수 있습니다. edge는 실제 저장된 신호만 표시합니다.</p><pre>선택 프로젝트: npm run preview:live\n격리된 데모: npm run demo:network\n데모 종료 후: npm run demo:reset</pre><p>서버가 출력한 URL을 여세요. 데모 시작 시 <code>.ai/demo/network-runtime</code>의 fixture 데이터를 교체하고 reset은 정확히 그 데모 디렉터리만 제거합니다. 선택 프로젝트 runtime은 건드리지 않습니다. <code>npm run preview</code>는 snapshot 기반 필터를 제공하는 정적 네트워크를 저장하며 polling하지 않습니다.</p>',
      'artifacts.empty': '등록된 UI 아티팩트가 없습니다.', 'artifacts.tabsLabel': 'UI 아티팩트 미리보기',
      'artifacts.refresh': '새로 고침', 'artifacts.open': '새 탭에서 열기',
      'artifacts.externalBlocked': '미리보기 랩 안전 정책에 따라 이 URL을 삽입하지 않습니다. 새 탭에서 열어 확인하세요.',
      'artifacts.schemeBlocked': '미리보기 랩 안전 정책에서 지원하지 않는 URL 형식입니다.',
      'artifacts.credentialsBlocked': '자격 증명이 포함된 URL은 미리보기 랩에서 열 수 없습니다.',
      'artifacts.urlHidden': '안전을 위해 URL 숨김',
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
