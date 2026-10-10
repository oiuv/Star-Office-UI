/* Native Codex thread metadata, shared by browser and desktop. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), panel = $('thread-archive-panel');
    if (!panel) return;
    const words = {
        zh: {title:'Codex 会话档案', note:'本地会话索引 · 来源、用量与协作轨迹', total:'会话', tokens:'Token 总量', models:'模型', projects:'项目', source:'会话来源', model:'模型', project:'项目', archive:'归档状态', sort:'排序', all:'全部', active:'未归档', archived:'已归档', recent:'最近活动', created:'创建时间', tokenSort:'Token 用量', search:'搜索', placeholder:'搜索标题、摘要、Agent 或会话 ID', refresh:'刷新', previous:'上一页', next:'下一页', loading:'正在读取会话档案…', missing:'暂无 Codex 会话数据库', error:'会话档案暂时无法读取，请刷新重试', empty:'没有符合条件的会话', unknown:'未记录', untitled:'未命名会话', user:'用户会话', subagent:'子 Agent', guardian_review:'权限审查', memory_consolidation:'记忆整理', startup:'启动来源', provider:'模型服务', reasoning:'推理强度', updated:'更新时间', id:'会话 ID', parent:'父会话', children:'子会话', agent:'Agent 路径', nickname:'Agent 昵称', role:'Agent 角色', branch:'Git 分支', commit:'Git 提交', version:'Codex 版本', preview:'会话摘要', pinned:'已置顶', details:'展开档案', close:'关闭', found:'筛选结果', parentView:'查看父会话', range:(start,end,total) => start+'–'+end+' / 共 '+total+' 条'},
        en: {title:'Codex sessions', note:'Local session index · sources, usage and collaboration', total:'Sessions', tokens:'Total tokens', models:'Models', projects:'Projects', source:'Thread source', model:'Model', project:'Project', archive:'Archive status', sort:'Sort', all:'All', active:'Unarchived', archived:'Archived', recent:'Recent activity', created:'Created', tokenSort:'Token usage', search:'Search', placeholder:'Search titles, previews, agents or session IDs', refresh:'Refresh', previous:'Previous', next:'Next', loading:'Loading sessions…', missing:'No Codex session database yet', error:'Sessions are unavailable. Please refresh to retry.', empty:'No matching sessions', unknown:'Unrecorded', untitled:'Untitled session', user:'User', subagent:'Subagent', guardian_review:'Permission review', memory_consolidation:'Memory consolidation', startup:'Startup source', provider:'Provider', reasoning:'Reasoning', updated:'Updated', id:'Session ID', parent:'Parent session', children:'Child sessions', agent:'Agent path', nickname:'Agent nickname', role:'Agent role', branch:'Git branch', commit:'Git commit', version:'Codex version', preview:'Session preview', pinned:'Pinned', details:'Expand session', close:'Close', found:'Matching sessions', parentView:'View parent', range:(start,end,total) => start+'–'+end+' / '+total},
        ja: {title:'Codex セッション履歴', note:'ローカル索引 · ソース、使用量、連携', total:'セッション', tokens:'合計 Token', models:'モデル', projects:'プロジェクト', source:'セッション種別', model:'モデル', project:'プロジェクト', archive:'アーカイブ', sort:'並び順', all:'すべて', active:'未アーカイブ', archived:'アーカイブ済み', recent:'最近の活動', created:'作成日時', tokenSort:'Token 使用量', search:'検索', placeholder:'タイトル、概要、Agent、セッション ID を検索', refresh:'更新', previous:'前へ', next:'次へ', loading:'読み込み中…', missing:'Codex セッションデータベースがありません', error:'読み込めません。更新して再試行してください。', empty:'該当するセッションがありません', unknown:'未記録', untitled:'無題のセッション', user:'ユーザー', subagent:'サブ Agent', guardian_review:'権限審査', memory_consolidation:'メモリ整理', startup:'起動元', provider:'プロバイダー', reasoning:'推論強度', updated:'更新日時', id:'セッション ID', parent:'親セッション', children:'子セッション', agent:'Agent パス', nickname:'Agent 名', role:'Agent ロール', branch:'Git ブランチ', commit:'Git コミット', version:'Codex バージョン', preview:'セッション概要', pinned:'固定', details:'詳細を開く', close:'閉じる', found:'検索結果', parentView:'親を表示', range:(start,end,total) => start+'–'+end+' / '+total+' 件'}
    };
    let language = localStorage.getItem('uiLang') || 'zh', open = false, data = null;
    let controller = null, generation = 0, fingerprint = '', state = 'loading';
    const filters = {query:'', source:'', model:'', project:'', archived:'', sort:'recent', offset:0};
    const expanded = new Set(), labels = () => words[language] || words.zh;
    const locale = () => ({zh:'zh-CN', en:'en-US', ja:'ja-JP'}[language] || 'zh-CN');
    const number = value => new Intl.NumberFormat(locale()).format(value ?? 0);
    const date = value => value ? new Date(value).toLocaleString(locale(), {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : labels().unknown;
    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }
    function sourceName(value) {
        const known = ['user','subagent','guardian_review','memory_consolidation'];
        return known.includes(value) ? labels()[value] : (value || labels().unknown);
    }
    function options(id, values, value, format = item => item.value || labels().unknown) {
        const select = $(id), entries = [node('option', '', labels().all)];
        entries[0].value = '';
        for (const item of values) {
            if (!item.value) continue;
            const option = node('option', '', format(item) + ' (' + number(item.count) + ')');
            option.value = item.value; entries.push(option);
        }
        if (value && !values.some(item => item.value === value)) {
            const option = node('option', '', value); option.value = value; entries.push(option);
        }
        select.replaceChildren(...entries); select.value = value;
    }
    function field(grid, key, value, rawKey) {
        const box = node('div', 'archive-field'), label = node('dt', '', labels()[key]);
        if (rawKey) label.append(node('small', '', rawKey));
        box.append(label, node('dd', '', value === '' || value == null ? labels().unknown : String(value)));
        grid.append(box);
    }
    function row(item) {
        const card = node('details', 'archive-row');
        card.dataset.id = item.id; card.open = expanded.has(item.id);
        card.addEventListener('toggle', () => { if (card.open) expanded.add(item.id); else expanded.delete(item.id); });
        const heading = node('summary', 'archive-row-summary'), main = node('div', 'archive-row-main');
        const badges = node('div', 'archive-badges'), badge = node('span', 'archive-source', sourceName(item.thread_source));
        badge.dataset.source = item.thread_source || '';
        badge.title = 'thread_source: ' + (item.thread_source || labels().unknown);
        badges.append(badge, node('span', 'archive-project', item.project || labels().unknown));
        if (item.is_pinned) badges.append(node('span', 'archive-flag', labels().pinned));
        if (item.archived) badges.append(node('span', 'archive-flag', labels().archived));
        main.append(badges, node('h3', '', item.title || labels().untitled));
        if (item.preview) main.append(node('p', 'archive-excerpt', item.preview.replace(/\s+/g, ' ')));
        const meta = node('div', 'archive-row-meta');
        meta.append(node('span', 'archive-model', item.model || labels().unknown));
        if (item.agent_nickname || item.agent_path) meta.append(node('span', '', item.agent_nickname || item.agent_path));
        main.append(meta);
        const usage = node('div', 'archive-usage');
        usage.append(node('strong', '', number(item.tokens_used)), node('span', '', 'tokens_used'));
        const time = node('time', '', date(item.recent_ms));
        if (item.recent_ms) time.dateTime = new Date(item.recent_ms).toISOString();
        usage.append(time, node('span', 'archive-expand', labels().details + ' ⌄'));
        heading.append(main, usage); card.append(heading);
        const detail = node('div', 'archive-detail'), grid = node('dl', 'archive-fields');
        for (const [key,value,raw] of [
            ['id',item.id],['source',item.thread_source,'thread_source'],['startup',item.startup_source,'source'],
            ['tokens',number(item.tokens_used),'tokens_used'],['model',item.model],['provider',item.model_provider],
            ['reasoning',item.reasoning_effort],['created',date(item.created_ms)],['updated',date(item.updated_ms)],
            ['branch',item.git_branch],['commit',item.git_sha],['version',item.cli_version]
        ]) field(grid,key,value,raw);
        for (const [key,value] of [['agent',item.agent_path],['nickname',item.agent_nickname],['role',item.agent_role],['children',item.child_count ? number(item.child_count) : '']]) {
            if (value) field(grid,key,value);
        }
        if (item.parent_id) {
            field(grid, 'parent', item.parent_id);
            const button = node('button', 'archive-parent', labels().parentView);
            button.type = 'button';
            button.addEventListener('click', () => {
                Object.assign(filters, {query:item.parent_id, source:'', model:'', project:'', archived:'', offset:0});
                $('archive-query').value = item.parent_id; load();
            });
            grid.lastElementChild.append(button);
        }
        detail.append(grid);
        if (item.preview) detail.append(node('h4', '', labels().preview), node('p', 'archive-preview', item.preview));
        card.append(detail); return card;
    }
    function render() {
        const w = labels(), status = $('archive-status'), list = $('archive-list');
        status.hidden = state === 'ready' && data?.threads.length > 0;
        status.textContent = w[state === 'ready' ? 'empty' : state];
        list.hidden = state !== 'ready'; $('archive-summary').hidden = !data?.available;
        $('archive-pager').hidden = state !== 'ready'; panel.setAttribute('aria-busy', String(state === 'loading'));
        if (!data?.available) { $('archive-result').textContent = ''; return; }
        const stats = [['total',data.summary.threads], ['tokens',data.summary.tokens_used],
            ['models',data.facets.models.filter(item => item.value).length], ['projects',data.facets.projects.filter(item => item.value).length]];
        $('archive-summary').replaceChildren(...stats.map(([label,value]) => {
            const box = node('div', 'archive-stat'), count = node('strong', '', number(value)); count.title = number(value);
            box.append(count, node('span', '', w[label])); return box;
        }));
        options('archive-source', data.facets.sources, filters.source, item => sourceName(item.value));
        options('archive-model', data.facets.models, filters.model); options('archive-project', data.facets.projects, filters.project);
        $('archive-archived').value = filters.archived; $('archive-sort').value = filters.sort;
        const key = language + JSON.stringify(data.threads);
        if (key !== fingerprint) {
            const top = list.scrollTop;
            const focused = list.contains(document.activeElement) ? document.activeElement.closest('.archive-row')?.dataset.id : null;
            list.replaceChildren(...data.threads.map(row)); fingerprint = key; list.scrollTop = top;
            if (focused) [...list.children].find(el => el.dataset.id === focused)?.querySelector('summary').focus({preventScroll:true});
        }
        const p = data.pagination;
        $('archive-page').textContent = w.range(p.total ? p.offset + 1 : 0, Math.min(p.offset + data.threads.length, p.total), number(p.total));
        $('archive-result').textContent = w.found + ': ' + number(data.filtered_summary.threads) + ' · ' + number(data.filtered_summary.tokens_used) + ' Token';
        $('archive-previous').disabled = p.offset <= 0; $('archive-next').disabled = p.offset + p.limit >= p.total;
    }
    async function load(poll = false) {
        if (!open || (poll && controller)) return;
        controller?.abort();
        const current = ++generation, pending = new AbortController(); controller = pending;
        if (!poll) { state = 'loading'; render(); }
        try {
            const response = await fetch('/api/codex-threads?' + new URLSearchParams(filters), {cache:'no-store', signal:pending.signal});
            const next = await response.json();
            if (current !== generation || !open) return;
            if (!response.ok || !next.ok) throw new Error('unavailable');
            if (next.available && next.pagination.total && next.pagination.offset >= next.pagination.total) {
                filters.offset = Math.floor((next.pagination.total - 1) / next.pagination.limit) * next.pagination.limit;
                controller = null; return load();
            }
            data = next; state = next.available ? 'ready' : 'missing'; render();
        } catch (error) {
            if (current !== generation || !open || error.name === 'AbortError') return;
            state = 'error'; render();
        } finally { if (current === generation) controller = null; }
    }
    function translate(lang) {
        language = words[lang] ? lang : 'zh';
        panel.querySelectorAll('[data-archive-text]').forEach(el => { el.textContent = labels()[el.dataset.archiveText]; });
        $('office-archive-button').querySelector('span').textContent = labels().title;
        $('archive-query').placeholder = labels().placeholder; $('archive-query').setAttribute('aria-label', labels().placeholder);
        $('archive-close').setAttribute('aria-label', labels().close); render();
    }
    for (const key of ['source','model','project','archived','sort']) {
        $('archive-' + key).addEventListener('change', event => {
            filters[key] = event.target.value; filters.offset = 0; $('archive-list').scrollTop = 0; load();
        });
    }
    $('archive-search').addEventListener('submit', event => {
        event.preventDefault(); filters.query = $('archive-query').value.trim(); filters.offset = 0;
        $('archive-list').scrollTop = 0; load();
    });
    $('archive-refresh').addEventListener('click', () => load());
    for (const [id,step] of [['previous',-1],['next',1]]) {
        $('archive-' + id).addEventListener('click', () => {
            if (!data) return;
            filters.offset = Math.max(0, data.pagination.offset + step * data.pagination.limit); $('archive-list').scrollTop = 0; load();
        });
    }
    panel.addEventListener('toggle', event => {
        open = event.newState === 'open'; $('office-archive-button').setAttribute('aria-expanded', String(open));
        if (open) load(); else { generation++; controller?.abort(); controller = null; }
        if (window.__TAURI__?.core) {
            const expanded = open || !!document.querySelector('.panel-collapsible:not(.collapsed), .office-panel:popover-open');
            window.__TAURI__.core.invoke('set_main_window_mode', {expanded}).catch(() => {});
        }
    });
    setInterval(() => { if (open && !document.hidden) load(true); }, 15000);
    document.addEventListener('visibilitychange', () => { if (open && !document.hidden) load(true); });
    window.ThreadArchive = {translate, refresh:() => load()};
    translate(language);
    if (window.location.hash === '#codex-threads') panel.showPopover();
})();
