/* Retained native Claude transcripts. Read on open or explicit refresh, never poll. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), panel = $('claude-archive-panel');
    if (!panel) return;
    const words = {
        zh: {title:'Claude Code 会话档案', note:'全局目录 · 本地保留的会话记录 · 打开或手动刷新时读取', scope:'统计按筛选会话汇总；模型筛选匹配包含该模型的会话。重复消息与工具调用按 ID 去重。', total:'主会话', agents:'子 Agent', tokens:'记录 Token 总量', tools:'工具调用', input:'输入', output:'输出', cacheRead:'缓存读取', cacheWrite:'缓存写入', ranks:'模型与工具排行', model:'会话模型', project:'项目', kind:'会话类型', main:'主会话', subagent:'子 Agent', sort:'排序', recent:'最近活动', created:'创建时间', tokenSort:'Token 用量', toolSort:'工具调用', all:'全部', search:'搜索', placeholder:'搜索标题、摘要或会话 ID', refresh:'刷新', previous:'上一页', next:'下一页', loading:'正在读取本地会话记录…', missing:'暂无 Claude Code 会话目录', error:'暂时无法读取，请刷新重试', empty:'没有符合条件的会话', unknown:'未记录', untitled:'未命名会话', id:'会话 ID', parent:'父会话', branch:'Git 分支', version:'Claude Code 版本', agent:'Agent 名称', updated:'最近活动', prompts:'用户消息', replies:'模型回复', preview:'首条用户消息', close:'关闭', coverage:'包含用量的回复', skipped:'未能解析的记录', unreadable:'无法读取的文件', unidentified:'缺少消息 ID 的用量记录', inherited:'单条档案包含其继承记录，用量不能直接逐行相加。', range:(start,end,total)=>start+'–'+end+' / 共 '+total+' 条'},
        en: {title:'Claude Code sessions', note:'Global directory · retained local transcripts · read on open or refresh', scope:'Totals cover matching sessions. Model filters match sessions containing that model. Messages and tool calls are deduplicated by ID.', total:'Main sessions', agents:'Subagents', tokens:'Recorded tokens', tools:'Tool calls', input:'Input', output:'Output', cacheRead:'Cache read', cacheWrite:'Cache write', ranks:'Models and top tools', model:'Session model', project:'Project', kind:'Session type', main:'Main', subagent:'Subagent', sort:'Sort', recent:'Recent activity', created:'Created', tokenSort:'Token usage', toolSort:'Tool calls', all:'All', search:'Search', placeholder:'Search titles, previews or session IDs', refresh:'Refresh', previous:'Previous', next:'Next', loading:'Reading local transcripts…', missing:'No Claude Code session directory yet', error:'Unavailable. Please refresh to retry.', empty:'No matching sessions', unknown:'Unrecorded', untitled:'Untitled session', id:'Session ID', parent:'Parent session', branch:'Git branch', version:'Claude Code version', agent:'Agent name', updated:'Recent activity', prompts:'User messages', replies:'Model replies', preview:'First user message', close:'Close', coverage:'Replies with usage', skipped:'Unparsed records', unreadable:'Unreadable files', unidentified:'Usage records without message IDs', inherited:'Individual sessions include inherited records; row totals cannot be added together.', range:(start,end,total)=>start+'–'+end+' / '+total},
        ja: {title:'Claude Code セッション履歴', note:'グローバルディレクトリ · 保持されたローカル履歴 · 開く時や更新時のみ読取', scope:'集計は該当セッション全体。モデル指定はそのモデルを含むセッション。メッセージとツール呼び出しは ID で重複除外。', total:'メイン', agents:'サブ Agent', tokens:'記録 Token', tools:'ツール呼び出し', input:'入力', output:'出力', cacheRead:'キャッシュ読取', cacheWrite:'キャッシュ書込', ranks:'モデルとツール順位', model:'セッションモデル', project:'プロジェクト', kind:'種類', main:'メイン', subagent:'サブ Agent', sort:'並び順', recent:'最近の活動', created:'作成日時', tokenSort:'Token 使用量', toolSort:'ツール呼び出し', all:'すべて', search:'検索', placeholder:'タイトル、概要、セッション ID を検索', refresh:'更新', previous:'前へ', next:'次へ', loading:'読み込み中…', missing:'Claude Code 履歴ディレクトリがありません', error:'読み込めません。更新して再試行してください。', empty:'該当セッションがありません', unknown:'未記録', untitled:'無題のセッション', id:'セッション ID', parent:'親セッション', branch:'Git ブランチ', version:'Claude Code バージョン', agent:'Agent 名', updated:'最近の活動', prompts:'ユーザーメッセージ', replies:'モデル応答', preview:'最初のユーザーメッセージ', close:'閉じる', coverage:'使用量のある応答', skipped:'解析できない記録', unreadable:'読取不可ファイル', unidentified:'メッセージ ID のない使用量', inherited:'個別履歴は継承記録を含むため、行の合計は加算できません。', range:(start,end,total)=>start+'–'+end+' / '+total+' 件'}
    };
    const tokenFields = [['input','input_tokens'],['output','output_tokens'],['cacheRead','cache_read_input_tokens'],['cacheWrite','cache_creation_input_tokens']];
    const buttonLabels = {zh:{menu:'Claude 会话档案',desktop:'Claude 会话档案'},en:{menu:'Claude sessions',desktop:'Claude sessions'},ja:{menu:'Claude セッション履歴',desktop:'Claude セッション履歴'}};
    let language = 'zh', open = false, data = null, controller = null, generation = 0, fingerprint = '', state = 'loading';
    try { language = localStorage.getItem('uiLang') || 'zh'; } catch (_) {}
    const filters = {query:'', kind:'', model:'', project:'', sort:'recent', offset:0}, expanded = new Set();
    const labels = () => words[language] || words.zh;
    const locale = () => ({zh:'zh-CN',en:'en-US',ja:'ja-JP'}[language] || 'zh-CN');
    const number = value => new Intl.NumberFormat(locale()).format(value ?? 0);
    const date = value => value ? new Date(value).toLocaleString(locale()) : labels().unknown;
    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }
    function stats(id, values) {
        $(id).replaceChildren(...values.map(([label,value]) => {
            const box = node('div','archive-stat'); box.append(node('strong','',number(value)),node('span','',labels()[label])); return box;
        }));
    }
    function options(key, values) {
        const entries = [node('option','',labels().all)]; entries[0].value = '';
        for (const item of values) {
            const option = node('option','',(key === 'kind' ? labels()[item.value] : item.value) + ' (' + number(item.count) + ')');
            option.value = item.value; entries.push(option);
        }
        if (filters[key] && !values.some(item => item.value === filters[key])) {
            const option = node('option','',filters[key]); option.value = filters[key]; entries.push(option);
        }
        $('claude-archive-' + key).replaceChildren(...entries); $('claude-archive-' + key).value = filters[key];
    }
    function row(item) {
        const w = labels(), card = node('details','archive-row'); card.dataset.id = item.id; card.open = expanded.has(item.id);
        card.addEventListener('toggle', () => { if (card.open) expanded.add(item.id); else expanded.delete(item.id); });
        const heading = node('summary','archive-row-summary'), main = node('div'), badges = node('div','archive-badges');
        const badge = node('span','archive-source',w[item.kind] || item.kind); badge.dataset.source = item.kind === 'main' ? 'user' : item.kind;
        badges.append(badge,node('span','archive-project',item.project));
        main.append(badges,node('h3','',item.title || w.untitled),node('p','archive-excerpt',item.models.join(' · ') || w.unknown));
        const meta = node('div','archive-row-meta'); meta.append(node('span','',w.tools + ': ' + number(item.tool_calls))); main.append(meta);
        const usage = node('div','archive-usage'); usage.append(node('strong','',item.usage_replies ? number(item.tokens) : w.unknown),node('span','','Token'),node('time','',date(item.updated_ms)));
        heading.append(main,usage); card.append(heading);
        const detail = node('div','archive-detail'), grid = node('dl','archive-fields');
        const values = [['id',item.id],['parent',item.parent_id],['agent',item.agent],['created',date(item.created_ms)],['updated',date(item.updated_ms)],['branch',item.branch],['version',item.version],['prompts',number(item.prompts)],['replies',number(item.replies)],...tokenFields.map(([label,key])=>[label,item.usage_replies ? number(item.usage[key]) : w.unknown])];
        for (const [label,value] of values) {
            if (!value && ['parent','agent','branch','version'].includes(label)) continue;
            const box = node('div','archive-field'); box.append(node('dt','',w[label]),node('dd','',value || w.unknown)); grid.append(box);
        }
        detail.append(grid,node('p','archive-note',w.inherited));
        if (item.preview) detail.append(node('h4','',w.preview),node('p','archive-preview',item.preview));
        card.append(detail); return card;
    }
    function render() {
        const w = labels(), status = $('claude-archive-status'), list = $('claude-archive-list');
        status.hidden = state === 'ready' && data?.sessions.length > 0; status.textContent = w[state === 'ready' ? 'empty' : state];
        list.hidden = state !== 'ready'; $('claude-archive-overview').hidden = !data?.available || state !== 'ready';
        $('claude-archive-pager').hidden = state !== 'ready'; panel.setAttribute('aria-busy', String(state === 'loading'));
        if (!data?.available || state !== 'ready') return;
        const s = data.filtered_summary;
        stats('claude-archive-summary',[['total',s.sessions],['agents',s.subagents],['tokens',s.tokens],['tools',s.tool_calls]]);
        stats('claude-archive-usage',tokenFields.map(([label,key])=>[label,s.usage[key]]));
        $('claude-archive-coverage').textContent = w.coverage + ': ' + number(s.usage_replies) + ' / ' + number(s.replies);
        for (const [field,label] of [['skipped_lines','skipped'],['unreadable_files','unreadable'],['unidentified_usage','unidentified']]) {
            if (data.coverage[field]) $('claude-archive-coverage').textContent += ' · ' + w[label] + ': ' + number(data.coverage[field]);
        }
        const ranks = $('claude-archive-rank-list');
        ranks.replaceChildren(node('p','archive-note',w.model + ': ' + (s.models.map(item=>item.value + ' ' + number(item.tokens) + ' Token').join(' · ') || w.unknown)),node('p','archive-note',w.tools + ': ' + (s.tools.slice(0,5).map(item=>item.value + ' × ' + number(item.count)).join(' · ') || '0')));
        for (const key of ['kind','model','project']) options(key,data.facets[{kind:'kinds',model:'models',project:'projects'}[key]]);
        $('claude-archive-sort').value = filters.sort;
        const key = language + JSON.stringify(data.sessions);
        if (key !== fingerprint) {
            const top = list.scrollTop, focused = list.contains(document.activeElement) ? document.activeElement.closest('.archive-row')?.dataset.id : null;
            list.replaceChildren(...data.sessions.map(row)); fingerprint = key; list.scrollTop = top;
            if (focused) [...list.children].find(el=>el.dataset.id === focused)?.querySelector('summary').focus({preventScroll:true});
        }
        const p = data.pagination;
        $('claude-archive-page').textContent = w.range(p.total ? p.offset + 1 : 0,Math.min(p.offset + data.sessions.length,p.total),number(p.total));
        $('claude-archive-previous').disabled = p.offset <= 0; $('claude-archive-next').disabled = p.offset + p.limit >= p.total;
    }
    async function load() {
        if (!open) return;
        controller?.abort(); const current = ++generation, pending = new AbortController(); controller = pending;
        state = 'loading'; render();
        try {
            const response = await fetch('/api/claude-sessions?' + new URLSearchParams(filters),{cache:'no-store',signal:pending.signal});
            if (!response.ok) throw new Error('unavailable');
            const next = await response.json();
            if (current !== generation || !open) return;
            if (!next.ok) throw new Error('unavailable');
            if (next.pagination.total > 0 && next.pagination.offset >= next.pagination.total) {
                filters.offset = Math.floor((next.pagination.total - 1) / next.pagination.limit) * next.pagination.limit; return load();
            }
            data = next; state = next.available ? 'ready' : 'missing'; render();
        } catch (error) {
            if (current !== generation || error.name === 'AbortError' || !open) return;
            state = 'error'; render();
        } finally { if (current === generation) controller = null; }
    }
    function translate(lang) {
        language = words[lang] ? lang : 'zh';
        panel.querySelectorAll('[data-claude-archive-text]').forEach(el=>{el.textContent = labels()[el.dataset.claudeArchiveText];});
        const button = $('office-claude-archive-button');
        button.querySelector('span').textContent = buttonLabels[language][button.dataset.claudeArchiveMenu ? 'menu' : 'desktop'];
        $('claude-archive-query').placeholder = labels().placeholder; $('claude-archive-query').setAttribute('aria-label',labels().placeholder);
        $('claude-archive-close').setAttribute('aria-label',labels().close); render();
    }
    for (const key of ['kind','model','project','sort']) $('claude-archive-' + key).addEventListener('change',event=>{filters[key] = event.target.value; filters.offset = 0; $('claude-archive-list').scrollTop = 0; load();});
    $('claude-archive-search').addEventListener('submit',event=>{event.preventDefault(); filters.query = $('claude-archive-query').value.trim(); filters.offset = 0; $('claude-archive-list').scrollTop = 0; load();});
    $('claude-archive-refresh').addEventListener('click',()=>load());
    for (const [key,step] of [['previous',-1],['next',1]]) $('claude-archive-' + key).addEventListener('click',()=>{
        if (!data) return; filters.offset = Math.max(0,data.pagination.offset + step * data.pagination.limit); $('claude-archive-list').scrollTop = 0; load();
    });
    panel.addEventListener('toggle',event=>{
        open = event.newState === 'open'; $('office-claude-archive-button').setAttribute('aria-expanded',String(open));
        if (open) load(); else { generation++; controller?.abort(); controller = null; }
        if (window.__TAURI__?.core) {
            const expanded = open || !!document.querySelector('.panel-collapsible:not(.collapsed), .office-panel:popover-open');
            window.__TAURI__.core.invoke('set_main_window_mode',{expanded}).catch(()=>{});
        }
    });
    window.ClaudeArchive = {translate, refresh:()=>load()}; translate(language);
    if (window.location.hash === '#claude-sessions') panel.showPopover();
})();
