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
      'section.goal': 'Goal', 'section.phase': 'Phase', 'section.activeAgents': 'Active Agents',
      'section.verification': 'Verification', 'section.tasks': 'Tasks', 'section.claims': 'Write Claims',
      'section.warnings': 'Watchdog Warnings', 'section.blockers': 'Blockers', 'section.signals': 'Signal Timeline',
      'section.network': 'Agent Signal Network', 'section.events': 'Recent Events', 'section.artifacts': 'Artifacts',
      'common.none': 'none', 'common.unknown': 'unknown', 'common.inherited': 'inherited',
      'dashboard.noGoal': 'No active goal', 'dashboard.noTask': 'no task', 'dashboard.unassigned': 'unassigned',
      'dashboard.unavailable': 'Dashboard unavailable: {message}',
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
      'guide.body': '<h2>Quick start</h2><pre>npm run init\nnpm run self-check</pre><p>Review and trust repository hooks with <code>/hooks</code>, then ask Codex for work normally.</p><h2>New Project Setup / Copying Pure Harness</h2><p>When Pure Harness is copied into a completely new project, <code>.ai/runtime</code> can retain the source project\'s goals, tasks, events, agents, and claims. <code>npm run init</code> fills in missing runtime files and fields; it does not completely clear an existing copied runtime, so remove that directory first.</p><p>From the new project root in Windows PowerShell, use this sequence:</p><pre># 1. Reset project-specific runtime state\nRemove-Item -Recurse -Force .ai\\runtime\nnpm run init\n\n# 2. Remove Pure Harness development Task Specs\n# Run only when starting a completely new project from a copied harness\nGet-ChildItem .ai\\tasks\\*.md |\nWhere-Object { $_.Name -ne &quot;README.md&quot; } |\nRemove-Item -Force\n\n# 3. Verify the copied harness\nnpm run self-check\nnpm test\n\n# 4. Start the Live Dashboard\nnpm run preview:live</pre><p>Files under <code>.ai/tasks/*.md</code> may be Pure Harness development Task Specs, and copied specs appear in Preview Lab. Delete specs other than <code>README.md</code> only for a completely new project. Do not delete <code>.ai/tasks</code> when continuing an existing project or preserving its Task Specs.</p><p>Review <code>.ai/memory</code> for source-project information, but do not automatically delete it; durable project knowledge may need to be retained. If <code>.git</code> was copied, run <code>git remote -v</code> and confirm the destination is not connected to the original Pure Harness remote.</p><pre>Current status: npm run status\nAnomaly check: npm run watchdog\nStatic preview: npm run preview\nLive dashboard: npm run preview:live\nAgent Network demo: npm run demo:network\nReset network demo: npm run demo:reset\nhttp://127.0.0.1:8765/\nHarness tests: npm test</pre><h2>Preview modes</h2><p><code>npm run preview</code> writes one static runtime and Task Spec snapshot and exits; an opened file does not refresh. <code>npm run preview:live</code> runs the localhost dashboard, which refreshes while the process is running.</p><h2>Plans and UI previews</h2><p>For MEDIUM/LARGE work, Planner may create a Task Spec under <code>.ai/tasks/*.md</code>. Preview Lab reads current plans and completion criteria; ask Codex to change them rather than editing there. For UI work only, Preview Manager may register one or more local artifact URLs. Route, hash, and query-string variants can be registered as separate preview tabs.</p><h2>Role flow</h2><p>SMALL: Main/Worker → minimum deterministic verification. MEDIUM: Planner → Worker → Verifier → Reviewer, combining roles only when justified. LARGE: Planner → impact analysis → isolated workers → integration → verification → review → supervisor checkpoint when needed.</p><h2>Verification</h2><p>Worker implements and tests. Verifier independently runs evidence. Reviewer checks correctness, regressions, edge cases, and weak tests. SubagentStop is not success; task state plus verification evidence determines completion.</p><h2>Watchdog and claims</h2><p>Watchdog detects deterministic anomalies; Supervisor judges recovery only for anomalies, repeated failures, or drift. Parallel writers claim non-overlapping scopes: <code>src/backend/</code> and <code>src/frontend/</code> can run together, while <code>src/</code> conflicts with <code>src/backend/</code>. Use sequential execution or worktree isolation on conflict.</p><h2>Model policy</h2><p>Main is user-selected/inherited. Sol handles implementation and complex judgment; Luna handles verification, research, and repetitive operations. Astra is exceptional manual escalation only. Role configuration lives in <code>.codex/config.toml</code> and <code>.codex/agents/</code>. A supported native spawn override may retry once with the matching GPT-5.6 role model only after an explicit GPT-6 model-unavailable error; ordinary task, test, tool, and timeout failures do not route models.</p>',
      'guide.networkBody': '<h2>Using the Agent Signal Network</h2><p>Active Agents shows current runners; Agent Signal Network shows recorded relationships and workflow; Signal Timeline shows the latest ten stored signals, newest first; Preview Lab shows result UI and artifacts. On the live Dashboard, select an agent or signal for details and use Live/History, task and failure filters, pan, zoom, Fit, and Reset. Edges come only from recorded signals.</p><pre>Real runtime: npm run preview:live\nIsolated demo: npm run demo:network\nAfter stopping demo: npm run demo:reset</pre><p>Open the URL printed by either server. The demo uses <code>.ai/demo/network-runtime</code>; reset removes exactly that directory and leaves <code>.ai/runtime</code> alone. <code>npm run preview</code> saves a static, interactive network labeled Snapshot History with snapshot-based filters; it does not poll. See README, Agent Signal Network, for the full workflow.</p>',
      'artifacts.empty': 'No UI artifacts registered.', 'artifacts.tabsLabel': 'UI artifact previews',
      'artifacts.refresh': 'Refresh', 'artifacts.open': 'Open separately',
      'artifacts.externalBlocked': 'This URL is not embedded by the Preview Lab safety policy. Use Open separately to inspect it.',
      'artifacts.schemeBlocked': 'This URL scheme is not supported by the Preview Lab safety policy.',
      'network.modeLabel': 'Network mode', 'network.live': 'Live', 'network.history': 'History',
      'network.snapshotHistory': 'Snapshot History', 'network.filterLabel': 'Network filter', 'network.all': 'All',
      'network.active': 'Active', 'network.failures': 'Failures', 'network.currentTask': 'Current Task',
      'network.taskLabel': 'Network task', 'network.zoomIn': 'Zoom in', 'network.zoomOut': 'Zoom out',
      'network.fit': 'Fit', 'network.reset': 'Reset', 'network.graphLabel': 'Agent Signal Network',
      'network.empty': 'Select an agent or signal. {agents} agents, {signals} signals.',
      'network.noData': 'No agents or signals in this snapshot.',
      'network.noActive': 'No active flow. Retained history is still shown.',
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
      'section.goal': '목표', 'section.phase': '단계', 'section.activeAgents': '활성 에이전트',
      'section.verification': '검증', 'section.tasks': '작업', 'section.claims': '쓰기 점유',
      'section.warnings': 'Watchdog 경고', 'section.blockers': '차단 요소', 'section.signals': '신호 타임라인',
      'section.network': '에이전트 신호 네트워크', 'section.events': '최근 이벤트', 'section.artifacts': '아티팩트',
      'common.none': '없음', 'common.unknown': '알 수 없음', 'common.inherited': '상속됨',
      'dashboard.noGoal': '활성 목표 없음', 'dashboard.noTask': '작업 없음', 'dashboard.unassigned': '미할당',
      'dashboard.unavailable': '대시보드를 사용할 수 없습니다: {message}',
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
      'guide.body': '<h2>빠른 시작</h2><pre>npm run init\nnpm run self-check</pre><p><code>/hooks</code>에서 저장소 hook을 검토하고 신뢰한 뒤 평소처럼 Codex에 작업을 요청하세요.</p><h2>새 프로젝트 설정 / Pure Harness 복사</h2><p>Pure Harness를 완전히 새로운 프로젝트로 복사하면 <code>.ai/runtime</code>에 원본 프로젝트의 목표, 작업, 이벤트, 에이전트, 점유 정보가 남을 수 있습니다. <code>npm run init</code>은 누락된 runtime 파일과 필드를 채우지만 이미 복사된 runtime 전체를 비우지는 않으므로 먼저 해당 디렉터리를 제거하세요.</p><p>새 프로젝트 루트에서 Windows PowerShell로 다음 순서를 사용하세요.</p><pre># 1. 프로젝트별 runtime 상태 초기화\nRemove-Item -Recurse -Force .ai\\runtime\nnpm run init\n\n# 2. Pure Harness 개발용 작업 명세 제거\n# 복사한 harness로 완전히 새 프로젝트를 시작할 때만 실행\nGet-ChildItem .ai\\tasks\\*.md |\nWhere-Object { $_.Name -ne &quot;README.md&quot; } |\nRemove-Item -Force\n\n# 3. 복사한 harness 검증\nnpm run self-check\nnpm test\n\n# 4. 실시간 대시보드 시작\nnpm run preview:live</pre><p><code>.ai/tasks/*.md</code>에는 Pure Harness 자체 개발용 작업 명세가 포함될 수 있으며 복사된 명세는 미리보기 랩에 표시됩니다. 완전히 새로운 프로젝트에서만 <code>README.md</code> 이외의 명세를 삭제하세요. 기존 프로젝트를 이어가거나 작업 명세를 보존해야 한다면 <code>.ai/tasks</code>를 삭제하지 마세요.</p><p><code>.ai/memory</code>에 원본 프로젝트 정보가 있는지 검토하되 자동으로 모두 삭제하지 마세요. 유지해야 할 프로젝트 지식이 있을 수 있습니다. <code>.git</code>도 복사했다면 <code>git remote -v</code>를 실행해 원본 Pure Harness remote에 연결되어 있지 않은지 확인하세요.</p><pre>현재 상태: npm run status\n이상 상태 확인: npm run watchdog\n정적 미리보기: npm run preview\n실시간 대시보드: npm run preview:live\n에이전트 네트워크 데모: npm run demo:network\n네트워크 데모 초기화: npm run demo:reset\nhttp://127.0.0.1:8765/\nHarness 테스트: npm test</pre><h2>미리보기 모드</h2><p><code>npm run preview</code>는 현재 runtime과 작업 명세 snapshot을 한 번 저장하고 종료하며, 열린 파일은 자동 갱신되지 않습니다. <code>npm run preview:live</code>는 실행 중 계속 갱신되는 localhost 대시보드를 제공합니다.</p><h2>계획과 UI 미리보기</h2><p>MEDIUM/LARGE 작업에서는 Planner가 <code>.ai/tasks/*.md</code>에 작업 명세를 만들 수 있습니다. 미리보기 랩은 현재 계획과 완료 기준을 읽으며 수정은 Codex에 요청하세요. UI 작업에서는 Preview Manager가 하나 이상의 로컬 artifact URL을 등록할 수 있고 route, hash, query string 변형을 별도 탭으로 등록할 수 있습니다.</p><h2>역할 흐름</h2><p>SMALL: Main/Worker → 최소 결정론적 검증. MEDIUM: Planner → Worker → Verifier → Reviewer. LARGE: Planner → 영향 분석 → 격리된 Worker → 통합 → 검증 → 리뷰 → 필요 시 Supervisor 점검.</p><h2>검증</h2><p>Worker는 구현하고 테스트합니다. Verifier는 독립적으로 증거를 실행합니다. Reviewer는 정확성, 회귀, 예외 상황, 약한 테스트를 확인합니다. SubagentStop은 성공을 뜻하지 않으며 작업 상태와 검증 증거가 완료 여부를 결정합니다.</p><h2>Watchdog와 점유</h2><p>Watchdog는 결정론적 이상 상태를 찾고 Supervisor는 이상, 반복 실패, 범위 이탈 시 복구를 판단합니다. 병렬 작성자는 겹치지 않는 범위를 점유합니다. 충돌 시 순차 실행이나 worktree 격리를 사용하세요.</p><h2>모델 정책</h2><p>Main은 사용자가 선택하거나 상속한 모델을 사용합니다. Sol은 구현과 복잡한 판단, Luna는 검증·조사·반복 작업을 담당합니다. Astra는 예외적인 수동 상향에만 사용합니다. 역할 설정은 <code>.codex/config.toml</code>과 <code>.codex/agents/</code>에 있습니다. 지원되는 native spawn override는 명시적인 GPT-6 모델 사용 불가 오류 뒤에만 대응하는 GPT-5.6 역할 모델로 한 번 재시도할 수 있습니다.</p>',
      'guide.networkBody': '<h2>에이전트 신호 네트워크 사용법</h2><p>활성 에이전트는 현재 실행자를, 에이전트 신호 네트워크는 기록된 관계와 흐름을, 신호 타임라인은 최신 저장 신호를, 미리보기 랩은 결과 UI와 아티팩트를 보여줍니다. 실시간 대시보드에서 에이전트나 신호를 선택해 상세 정보를 보고 실시간/기록, 작업·실패 필터, 이동, 확대·축소, 맞춤, 초기화를 사용할 수 있습니다. edge는 실제 저장된 신호만 표시합니다.</p><pre>실제 runtime: npm run preview:live\n격리된 데모: npm run demo:network\n데모 종료 후: npm run demo:reset</pre><p>서버가 출력한 URL을 여세요. 데모는 <code>.ai/demo/network-runtime</code>을 사용하며 reset은 정확히 그 디렉터리만 제거하고 <code>.ai/runtime</code>은 건드리지 않습니다. <code>npm run preview</code>는 snapshot 기반 필터를 제공하는 정적·대화형 네트워크를 저장하며 polling하지 않습니다.</p>',
      'artifacts.empty': '등록된 UI 아티팩트가 없습니다.', 'artifacts.tabsLabel': 'UI 아티팩트 미리보기',
      'artifacts.refresh': '새로 고침', 'artifacts.open': '새 탭에서 열기',
      'artifacts.externalBlocked': '미리보기 랩 안전 정책에 따라 이 URL을 삽입하지 않습니다. 새 탭에서 열어 확인하세요.',
      'artifacts.schemeBlocked': '미리보기 랩 안전 정책에서 지원하지 않는 URL 형식입니다.',
      'network.modeLabel': '네트워크 모드', 'network.live': '실시간', 'network.history': '기록',
      'network.snapshotHistory': 'Snapshot 기록', 'network.filterLabel': '네트워크 필터', 'network.all': '전체',
      'network.active': '활성', 'network.failures': '실패', 'network.currentTask': '현재 작업',
      'network.taskLabel': '네트워크 작업', 'network.zoomIn': '확대', 'network.zoomOut': '축소',
      'network.fit': '맞춤', 'network.reset': '초기화', 'network.graphLabel': '에이전트 신호 네트워크',
      'network.empty': '에이전트 또는 신호를 선택하세요. 에이전트 {agents}개, 신호 {signals}개.',
      'network.noData': '이 snapshot에는 에이전트나 신호가 없습니다.',
      'network.noActive': '활성 흐름이 없습니다. 보존된 기록은 계속 표시됩니다.',
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
