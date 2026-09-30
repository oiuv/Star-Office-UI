(() => {
  'use strict';
  const STATES = ['idle','writing','researching','executing','syncing','error'];
  const HOOKS = ['PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','SessionStart','SessionEnd','UserPromptSubmit','SubagentStart','SubagentStop','Stop','Interrupt'];
  const TEXT = {
    zh: {
      back:'返回办公室 ↗',title:'每一次行动，都留下足迹。',subtitle:'从像素办公室，到你的 AI 活动档案。',
      loading:'正在读取记录…',live:'每 10 秒更新',today:'今日',week:'近 7 天',month:'近 30 天',all:'全部',
      export:'导出最近 200 条',journey:'办公室成长记录',next:'下一等级',states:'角色状态',countTime:'次数 / 观测时长',
      trend:'每日活动',events:'接收事件',trendNote:'全部视图显示最近 30 天趋势。',hooks:'Codex 生命周期',hookNote:'12 类事件 · 6 种动画状态',
      details:'运行概览',log:'活动日志',stateFilter:'状态筛选',hookFilter:'事件筛选',allStates:'全部状态',allHooks:'全部事件',
      measurement:'次数按实际接收事件统计，心跳单独标记；多 Agent 时长累加，每次状态最多观测 5 分钟，断联时间不累加。',
      scoreNote:'经验值是活动纪念：回合结束 +20，工具成功 +2，子 Agent 收尾 +10。次数与经验值不代表任务质量或 Token 用量。',
      empty:'还没有活动。接入 Codex hooks，或推送一次状态，记录就会从这里开始。',noMatch:'所选条件下没有活动。',failed:'读取失败，稍后自动重试。',
      turns:'结束回合',tools:'工具执行',active:'工作观测时长',heartbeat:'心跳',transitions:'状态切换',sessions:'会话',permissions:'权限等待',
      interrupts:'中断',compactions:'上下文整理',subagents:'子 Agent 启动',errors:'工具错误',stateUpdates:'主动状态更新',
      average:'工具平均耗时',measured:'个配对样本',xpPeriod:'本期经验值',late:'迟到事件，未改变角色',online:'在线',offline:'离线',
      mainCharacter:'主角色',codexDriver:'Codex hooks',stateDriver:'主动调用',lastUpdate:'最近更新',presenceNote:'Star 为办公室主角色，在线按最近 5 分钟收到的状态更新判断。',
      first_turn:'初次收工',tool_100:'工具熟练者',teamwork:'协作伙伴',context_keeper:'记忆管理员',
      stateLabels:['待命','写作','调研','执行','同步','异常'],hookLabels:['工具执行前','等待权限','工具结果','压缩前','压缩后','会话开始','会话结束','接收任务','子 Agent 开始','子 Agent 收尾','回合结束','用户中断']
    },
    en: {
      back:'Back to office ↗',title:'Every action leaves a trace.',subtitle:'Your pixel office, with a record of the work behind it.',
      loading:'Reading activity…',live:'Updates every 10s',today:'Today',week:'7 days',month:'30 days',all:'All time',
      export:'Export latest 200',journey:'OFFICE PROGRESS',next:'Next level',states:'Character states',countTime:'Count / observed time',
      trend:'Daily activity',events:'Events received',trendNote:'All-time view shows the last 30 days.',hooks:'Codex lifecycle',hookNote:'12 events · 6 animation states',
      details:'Run overview',log:'Activity log',stateFilter:'State filter',hookFilter:'Event filter',allStates:'All states',allHooks:'All events',
      measurement:'Counts reflect received events; heartbeats are marked separately. Actor times are summed, capped at 5 minutes per update; disconnected time is excluded.',
      scoreNote:'Activity keepsakes: turn ended +20 XP, successful tool +2, subagent ended +10. Counts and XP do not measure task quality or token usage.',
      empty:'No activity yet. Connect Codex hooks or send a state update to start your record.',noMatch:'No activity matches these filters.',failed:'Could not load activity. Retrying automatically.',
      turns:'Turns ended',tools:'Tools completed',active:'Observed work',heartbeat:'Heartbeats',transitions:'State changes',sessions:'Sessions',permissions:'Permission requests',
      interrupts:'Interruptions',compactions:'Compactions',subagents:'Subagents started',errors:'Tool errors',stateUpdates:'State updates',
      average:'Average tool time',measured:'paired samples',xpPeriod:'XP this period',late:'Late event; character unchanged',online:'online',offline:'offline',
      mainCharacter:'Main character',codexDriver:'Codex hooks',stateDriver:'State updates',lastUpdate:'Last update',presenceNote:'Star is the main office character. Presence reflects state updates received within the last 5 minutes.',
      first_turn:'First finish',tool_100:'Tool regular',teamwork:'Team player',context_keeper:'Memory keeper',
      stateLabels:['Idle','Writing','Research','Executing','Syncing','Error'],hookLabels:['Before tool','Permission wait','Tool result','Before compact','After compact','Session starts','Session ends','New prompt','Subagent starts','Subagent ends','Turn ends','Interrupted']
    },
    ja: {
      back:'オフィスに戻る ↗',title:'すべての行動に、足跡を。',subtitle:'ピクセルオフィスから、AI の活動記録へ。',
      loading:'記録を読み込み中…',live:'10 秒ごとに更新',today:'今日',week:'7 日間',month:'30 日間',all:'全期間',
      export:'最新 200 件を出力',journey:'オフィスの成長記録',next:'次のレベル',states:'キャラクター状態',countTime:'回数 / 観測時間',
      trend:'日別の活動',events:'受信イベント',trendNote:'全期間では直近 30 日の推移を表示。',hooks:'Codex ライフサイクル',hookNote:'12 イベント · 6 アニメーション状態',
      details:'実行概要',log:'活動ログ',stateFilter:'状態フィルター',hookFilter:'イベントフィルター',allStates:'すべての状態',allHooks:'すべてのイベント',
      measurement:'回数は受信イベントを集計。ハートビートは別表示。複数 Agent の時間は合計し、更新ごと最大 5 分まで観測します。',
      scoreNote:'活動の記念：ターン終了 +20 XP、ツール成功 +2、子 Agent 終了 +10。品質や Token 使用量を表すものではありません。',
      empty:'まだ記録がありません。Codex hooks を接続するか、状態を送信してください。',noMatch:'条件に一致する活動はありません。',failed:'読み込みに失敗しました。自動再試行します。',
      turns:'終了ターン',tools:'ツール完了',active:'作業観測時間',heartbeat:'ハートビート',transitions:'状態変更',sessions:'セッション',permissions:'権限待ち',
      interrupts:'中断',compactions:'コンテキスト整理',subagents:'子 Agent 開始',errors:'ツールエラー',stateUpdates:'状態更新',
      average:'ツール平均時間',measured:'組のサンプル',xpPeriod:'期間 XP',late:'遅延イベント：状態変更なし',online:'オンライン',offline:'オフライン',
      mainCharacter:'メインキャラクター',codexDriver:'Codex hooks',stateDriver:'状態更新',lastUpdate:'最終更新',presenceNote:'Star はオフィスのメインキャラクターです。直近 5 分の状態更新をもとにオンラインを表示します。',
      first_turn:'初めての完了',tool_100:'ツール名人',teamwork:'協力者',context_keeper:'記憶管理者',
      stateLabels:['待機','執筆','調査','実行','同期','エラー'],hookLabels:['ツール実行前','権限待ち','ツール結果','圧縮前','圧縮後','セッション開始','セッション終了','新しいタスク','子 Agent 開始','子 Agent 終了','ターン終了','中断']
    }
  };
  let lang = 'zh';
  try { lang = localStorage.getItem('uiLang') || 'zh'; } catch (_) {}
  if (!TEXT[lang]) lang = 'zh';
  let period = 'today', lastData = null, controller = null;
  const $ = id => document.getElementById(id);
  const t = key => TEXT[lang][key] || key;
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = value => Number(value || 0).toLocaleString();
  const duration = seconds => seconds < 60 ? Math.round(seconds) + 's' : seconds < 3600 ? Math.round(seconds / 60) + 'm' : (seconds / 3600).toFixed(1) + 'h';
  const stateLabel = state => TEXT[lang].stateLabels[STATES.indexOf(state)] || state;
  function options(select, values, labels, first) {
    const selected = select.value;
    select.replaceChildren(new Option(first,''));
    values.forEach((value,i) => select.add(new Option(labels[i],value)));
    select.value = selected;
  }
  function translate() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-lang]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.lang === lang)));
    options($('state-filter'),STATES,TEXT[lang].stateLabels,t('allStates'));
    options($('hook-filter'),[...HOOKS,'StateUpdate'],[...HOOKS,t('stateUpdates')],t('allHooks'));
  }
  function renderActors(actors, office) {
    // /status selects the controller of the same Star character shown in the office.
    const mainId = office.actor_id || 'main';
    const primary = actors.find(actor => actor.actor_id === mainId);
    const codexControlsStar = primary?.source === 'codex' && !primary.is_subagent;
    const displayed = actors.filter(actor => !(codexControlsStar && actor.actor_id === 'main'));
    displayed.sort((a,b) => Number(b.actor_id === mainId) - Number(a.actor_id === mainId)
      || Number(b.online) - Number(a.online) || b.updated_at - a.updated_at);
    $('actors').replaceChildren(...displayed.slice(0,20).map(actor => {
      const isMain = actor.actor_id === mainId;
      const label = [isMain ? 'Star' : actor.actor_name,
        isMain ? t(actor.source === 'codex' ? 'codexDriver' : 'stateDriver') : '',
        t(actor.online ? 'online' : 'offline')].filter(Boolean).join(' · ');
      const badge = element('span','actor' + (actor.online ? ' online' : ''),label);
      badge.title = [isMain ? t('mainCharacter') : '',actor.actor_name,stateLabel(actor.state),
        t('lastUpdate') + ': ' + new Date(actor.updated_at * 1000).toLocaleString()].filter(Boolean).join(' · ');
      return badge;
    }));
  }
  function render(stats, events, office) {
    const o = stats.overview, game = stats.game;
    $('connection').textContent = t('live');
    $('metrics').replaceChildren();
    [
      [t('events'),number(o.events),number(o.heartbeats) + ' ' + t('heartbeat')],
      [t('turns'),number(o.turns),number(o.sessions) + ' ' + t('sessions')],
      [t('tools'),number(o.tools),number(o.tool_errors) + ' ' + t('errors')],
      [t('active'),duration(o.active_seconds),number(o.transitions) + ' ' + t('transitions')]
    ].forEach(([label,value,note]) => {
      const card = element('div','metric');
      card.append(element('div','metric-label',label),element('div','metric-value',value),element('div','metric-note',note));
      $('metrics').append(card);
    });
    $('level').textContent = 'LV. ' + game.level;
    $('xp-text').textContent = number(game.xp) + ' XP · +' + game.period_xp + ' ' + t('xpPeriod');
    $('level-progress').textContent = game.level_xp + ' / 100 XP';
    $('xp-progress').value = game.level_xp;
    $('badges').replaceChildren(...game.badges.map(badge => element('span','badge' + (badge.earned ? ' earned' : ''),(badge.earned ? '✦ ' : '◇ ') + t(badge.id))));
    $('states').replaceChildren();
    const maximum = Math.max(1,...Object.values(stats.states).map(value => value.count));
    STATES.forEach(state => {
      const v = stats.states[state], row = element('div','state-row'), track = element('div','state-track'), fill = element('div','state-fill');
      fill.style.width = (v.count / maximum * 100) + '%';
      track.append(fill);
      row.append(element('span','',stateLabel(state)),track,element('span','state-value',v.count + ' / ' + duration(v.seconds)));
      $('states').append(row);
    });
    $('hooks').replaceChildren(...HOOKS.map((hook,i) => {
      const card = element('div','hook-card' + (stats.hooks[hook] ? ' seen' : ''));
      card.append(element('div','hook-name',hook),element('div','hook-count',number(stats.hooks[hook])),element('div','hook-detail',TEXT[lang].hookLabels[i]));
      return card;
    }));
    const daily = new Map(stats.daily.map(day => [day.date,day]));
    const end = new Date(stats.until * 1000), start = new Date(Math.max(stats.since * 1000,end.getTime() - 29 * 86400000));
    start.setHours(0,0,0,0);
    const days = [];
    for (let day = new Date(start); day <= end; day.setDate(day.getDate()+1)) {
      const key = day.getFullYear() + '-' + String(day.getMonth()+1).padStart(2,'0') + '-' + String(day.getDate()).padStart(2,'0');
      days.push(daily.get(key) || {date:key,events:0});
    }
    const peak = Math.max(1,...days.map(day => day.events));
    $('daily').replaceChildren(...days.map((day,i) => {
      const column = element('div','day'), bar = element('div','day-fill');
      bar.style.height = Math.max(2,day.events / peak * 130) + 'px';
      column.title = day.date + ': ' + day.events + ' ' + t('events');
      column.setAttribute('aria-label',column.title);
      column.append(bar,element('div','day-label',days.length <= 7 || i % 5 === 0 || i === days.length-1 ? day.date.slice(5) : ''));
      return column;
    }));
    $('details').replaceChildren(...[
      ['permissions',o.permission_requests],['interrupts',o.interrupts],['compactions',o.compactions],['subagents',o.subagents],
      ['sessions',o.sessions],['stateUpdates',o.state_updates],['heartbeat',o.heartbeats],['errors',o.tool_errors]
    ].map(([label,value]) => {
      const box = element('div','detail',t(label)); box.append(element('strong','',number(value))); return box;
    }));
    $('tool-duration').textContent = t('average') + ': ' + (o.average_tool_seconds === null ? '—' : duration(o.average_tool_seconds)) + ' · ' + o.measured_tools + ' ' + t('measured');
    renderActors(stats.actors, office);
    $('event-list').replaceChildren();
    if (!events.length) {
      $('event-list').append(element('div','empty',stats.overview.events ? t('noMatch') : t('empty')));
    }
    events.forEach(event => {
      const row = element('div','event'), time = new Date(event.occurred_at * 1000);
      const body = element('div','event-detail',event.detail);
      body.append(element('div','event-meta',[
        event.actor_name,stateLabel(event.state),event.source,event.heartbeat ? t('heartbeat') : '',
        !event.applied ? t('late') : ''
      ].filter(Boolean).join(' · ')));
      row.append(element('time','event-time',time.toLocaleDateString() + '\n' + time.toLocaleTimeString()),element('div','event-hook',event.event_name),body);
      $('event-list').append(row);
    });
  }
  async function get(url, signal, requireSuccess = true) {
    const response = await fetch(url,{cache:'no-store',signal});
    const data = await response.json();
    if (!response.ok || (requireSuccess && !data.ok)) throw new Error(data.msg || response.status);
    return data;
  }
  async function refresh() {
    if (controller) controller.abort();
    controller = new AbortController();
    const params = new URLSearchParams({period,limit:'50'});
    if ($('state-filter').value) params.set('state',$('state-filter').value);
    if ($('hook-filter').value) params.set('hook',$('hook-filter').value);
    try {
      const [stats,history,office] = await Promise.all([
        get('/api/stats?period='+period,controller.signal),
        get('/api/events?'+params,controller.signal),
        get('/status',controller.signal,false)
      ]);
      lastData = [stats,history.events,office]; render(...lastData); $('error').hidden = true;
    } catch (error) {
      if (error.name === 'AbortError') return;
      $('error').textContent = t('failed'); $('error').hidden = false;
      $('connection').textContent = t('failed');
    }
  }
  document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click',() => {
    lang = button.dataset.lang;
    try { localStorage.setItem('uiLang',lang); } catch (_) {}
    translate(); if (lastData) render(...lastData);
  }));
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click',() => {
    period = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
    refresh();
  }));
  $('state-filter').addEventListener('change',refresh); $('hook-filter').addEventListener('change',refresh);
  $('export').addEventListener('click',async () => {
    try {
      const params = new URLSearchParams({period,limit:'200'});
      if ($('state-filter').value) params.set('state',$('state-filter').value);
      if ($('hook-filter').value) params.set('hook',$('hook-filter').value);
      const data = await get('/api/events?'+params);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.events,null,2)],{type:'application/json'}));
      const link = element('a'); link.href = url; link.download = 'star-office-events.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch (_) { $('error').textContent = t('failed'); $('error').hidden = false; }
  });
  translate(); refresh();
  setInterval(() => { if (!document.hidden) refresh(); },10000);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) refresh(); });
})();
