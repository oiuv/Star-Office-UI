/* Shared read-only Codex discussions for the browser and desktop office. */
(() => {
    'use strict';
    const words = {
        zh: { title:'Agent 留言板', source:'Codex · 只读协作讨论', session:'会话', channel:'频道', author:'作者', allAuthors:'全部 Agent', search:'搜索留言与回复', searchButton:'搜索', refresh:'刷新', close:'关闭', threads:'讨论主题', discussion:'主题与回复', previous:'上一页', next:'下一页', previousReplies:'较早回复', nextReplies:'更多回复', loading:'正在读取留言板…', empty:'暂无讨论主题', missing:'未找到本地留言板数据库。请确认 Codex 已启用留言板，并产生过协作讨论。', error:'留言板暂时无法读取，请点击刷新重试。', notFound:'原会话已不可用，点击刷新重新选择。', noPosts:'选择一个主题查看讨论。', unreadable:'这条留言的数据无法解析。', truncated:'正文过长，已截断显示。', main:'主 Agent', table:'表格', topicPost:'主题帖', replyPost:'{number}楼', replySection:'回复（{count}）', replyOrder:'按发表时间排序', viewReplies:'查看回复（{count}）↓', noReplies:'暂无回复', emptyReplies:'本页暂无回复', copy:'复制代码', copied:'已复制', copyError:'复制失败，可直接选中代码复制', newMessages:'本会话新增 {count} 条留言 · 查看', messages:'留言', topics:'主题', agents:'参与 Agent', replies:'回复', page:'第 {start}–{end} 条 / 共 {total} 条', project:'未标注项目', scope:'当前会话 · 全部历史', matchNote:'搜索与作者筛选包含回复；打开主题后显示完整讨论。' },
        en: { title:'Agent message board', source:'Codex · Read-only discussions', session:'Session', channel:'Channel', author:'Author', allAuthors:'All agents', search:'Search posts and replies', searchButton:'Search', refresh:'Refresh', close:'Close', threads:'Discussion topics', discussion:'Topic and replies', previous:'Previous', next:'Next', previousReplies:'Earlier replies', nextReplies:'More replies', loading:'Loading discussions…', empty:'No matching discussions', missing:'Local message-board database not found. Check that Codex message boards are enabled and have been used.', error:'Could not read the board. Select Refresh to retry.', notFound:'This session is no longer available. Refresh to choose again.', noPosts:'Select a topic to read the discussion.', unreadable:'This message could not be decoded.', truncated:'Long message truncated for display.', main:'Main agent', table:'Table', topicPost:'Original post', replyPost:'#{number}', replySection:'Replies ({count})', replyOrder:'Oldest first', viewReplies:'View replies ({count}) ↓', noReplies:'No replies yet', emptyReplies:'No replies on this page', copy:'Copy code', copied:'Copied', copyError:'Copy failed; select the code to copy it manually', newMessages:'{count} new posts in this session · View', messages:'Posts', topics:'Topics', agents:'Agents', replies:'Replies', page:'{start}–{end} of {total}', project:'Unspecified project', scope:'Current session · All history', matchNote:'Search and author filters include replies. Topics show the full discussion.' },
        ja: { title:'Agent 掲示板', source:'Codex · 読み取り専用の議論', session:'セッション', channel:'チャンネル', author:'投稿者', allAuthors:'全 Agent', search:'投稿と返信を検索', searchButton:'検索', refresh:'更新', close:'閉じる', threads:'議論のトピック', discussion:'トピックと返信', previous:'前へ', next:'次へ', previousReplies:'以前の返信', nextReplies:'次の返信', loading:'掲示板を読み込み中…', empty:'該当する議論はありません', missing:'ローカル掲示板が見つかりません。Codex の掲示板を有効にし、協作で使用してください。', error:'読み込めませんでした。更新して再試行してください。', notFound:'セッションが利用できません。更新して選び直してください。', noPosts:'トピックを選択してください。', unreadable:'この投稿を解析できませんでした。', truncated:'長い本文を省略して表示しています。', main:'主 Agent', table:'表', topicPost:'トピック', replyPost:'#{number}', replySection:'返信（{count}）', replyOrder:'投稿順', viewReplies:'返信を見る（{count}）↓', noReplies:'返信はまだありません', emptyReplies:'このページには返信がありません', copy:'コードをコピー', copied:'コピー済み', copyError:'コピーできません。コードを選択して手動でコピーしてください', newMessages:'このセッションに新しい投稿 {count} 件 · 表示', messages:'投稿', topics:'トピック', agents:'参加 Agent', replies:'返信', page:'{start}–{end} / {total} 件', project:'プロジェクト未指定', scope:'現在のセッション · 全履歴', matchNote:'検索と投稿者の絞り込みは返信も対象。トピックには議論全体を表示します。' }
    };
    const $ = id => document.getElementById(id);
    const panel = $('agent-board-panel');
    if (!panel) return;
    let language = 'zh';
    try { language = localStorage.getItem('uiLang') || 'zh'; } catch (_) {}
    if (!words[language]) language = 'zh';
    let data = null, state = 'loading', open = false, controller = null, generation = 0;
    let baseline = null, incoming = 0, postsKey = '', topicsKey = '', activeTopic = '';
    const filters = {board:'', channel:'', thread:'', author:'', query:'', offset:0, reply_offset:0};
    const labels = () => words[language];
    const element = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    };
    function options(select, items, selected) {
        const key = JSON.stringify(items);
        if (select.dataset.optionsKey !== key) {
            select.replaceChildren(...items.map(([value, text]) => {
                const option = element('option', '', text); option.value = value; return option;
            }));
            select.dataset.optionsKey = key;
        }
        select.value = selected;
    }
    function date(value) {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : 'en-US') : '';
    }
    function authorName(value) {
        return value === '/root' ? labels().main : (value.split('/').filter(Boolean).at(-1) || value);
    }
    function pageLabel(page) {
        return labels().page.replace('{start}', page.total ? page.offset + 1 : 0)
            .replace('{end}', Math.min(page.offset + page.limit, page.total)).replace('{total}', page.total);
    }
    function pager(prefix, page) {
        $(prefix + '-previous').disabled = page.offset === 0;
        $(prefix + '-next').disabled = !page.has_more;
        $(prefix + '-page').textContent = pageLabel(page);
        $(prefix + '-pager').hidden = page.total <= page.limit;
    }
    function renderBody(text, target) {
        if (window.OfficeMarkdown) return window.OfficeMarkdown.render(text, target, {language});
        const body = element('div', 'board-markdown');
        body.append(element('p', 'board-literal', text));
        target.append(body);
    }
    function renderPosts() {
        const key = JSON.stringify([language, data?.thread_id, data?.posts, data?.reply_pagination]);
        if (key === postsKey) return;
        postsKey = key;
        const root = $('board-posts'), scroll = root.scrollTop;
        const sameTopic = activeTopic === data?.thread_id;
        const focused = document.activeElement;
        const focusedId = root.contains(focused) ? focused.id : '';
        activeTopic = data?.thread_id || '';
        root.replaceChildren();
        if (!data?.posts?.length) root.append(element('p', 'board-empty', labels().noPosts));
        const posts = data?.posts || [], l = labels();
        const replyTotal = data?.reply_pagination?.total ?? posts.filter(post => post.id !== data.thread_id).length;
        let floor = data?.reply_pagination?.offset || 0;
        const replies = element('section', 'board-replies');
        replies.setAttribute('aria-labelledby', 'board-replies-title');
        const divider = element('div', 'board-replies-heading');
        divider.id = 'board-replies-heading'; divider.tabIndex = -1;
        const title = element('h4', '', l.replySection.replace('{count}', replyTotal));
        title.id = 'board-replies-title'; divider.append(title);
        if (replyTotal) divider.append(element('span', 'board-note', l.replyOrder));
        replies.append(divider);
        for (const post of posts) {
            const isTopic = post.id === data.thread_id;
            const label = isTopic ? l.topicPost : l.replyPost.replace('{number}', ++floor);
            const article = element('article', 'board-post ' + (isTopic ? 'board-original' : 'board-reply'));
            article.id = 'board-post-' + post.id; article.dataset.kind = isTopic ? 'topic' : 'reply';
            article.setAttribute('aria-label', label + ' · ' + authorName(post.author));
            const badge = element('span', 'board-post-badge', label);
            const kind = isTopic ? element('div', 'board-post-kind') : null;
            if (kind) kind.append(badge);
            if (isTopic && replyTotal) {
                const jump = element('button', 'board-reply-jump', l.viewReplies.replace('{count}', replyTotal));
                jump.id = 'board-replies-jump'; jump.type = 'button';
                jump.addEventListener('click', () => {
                    divider.scrollIntoView({block:'start'});
                    divider.focus({preventScroll:true});
                });
                kind.append(jump);
            }
            const head = element('div', 'board-post-head');
            const identity = element('div', 'board-identity');
            if (!isTopic) identity.append(badge);
            identity.append(element('strong', '', authorName(post.author)), element('span', 'board-agent-path', post.author));
            const time = element('time', '', date(post.created_at)); time.dateTime = post.created_at;
            head.append(identity, time);
            if (kind) article.append(kind);
            article.append(head);
            if (post.unreadable) article.append(element('p', 'board-empty', l.unreadable));
            else renderBody(post.text, article);
            article.querySelectorAll('.board-copy').forEach((button, i) => { button.id = 'board-copy-' + post.id + '-' + i; });
            if (post.truncated) article.append(element('p', 'board-note', l.truncated));
            (isTopic ? root : replies).append(article);
        }
        if (posts.length) {
            if (!posts.some(post => post.id !== data.thread_id)) {
                replies.append(element('p', 'board-empty', replyTotal ? l.emptyReplies : l.noReplies));
            }
            root.append(replies);
        }
        root.scrollTop = sameTopic ? scroll : 0;
        if (sameTopic && focusedId) $(focusedId)?.focus({preventScroll:true});
    }
    function renderTopics() {
        const key = JSON.stringify([language, data?.threads, data?.thread_id]);
        if (key === topicsKey) return;
        topicsKey = key;
        const list = $('board-topics'), scroll = list.scrollTop;
        const focusedId = list.contains(document.activeElement) ? document.activeElement.id : '';
        list.replaceChildren();
        if (!data?.threads?.length) list.append(element('p', 'board-empty', labels().empty));
        for (const topic of data?.threads || []) {
            const button = element('button', 'board-topic');
            button.type = 'button'; button.id = 'board-topic-' + topic.id;
            button.dataset.thread = topic.id;
            button.setAttribute('aria-pressed', String(topic.id === data.thread_id));
            button.append(element('span', 'board-topic-preview', topic.unreadable ? labels().unreadable : topic.preview),
                element('span', 'board-topic-meta', authorName(topic.author) + ' · ' + topic.reply_count + ' ' + labels().replies));
            button.addEventListener('click', async () => {
                filters.thread = topic.id; filters.reply_offset = 0;
                if (await load(false)) $('board-discussion-title').focus();
            });
            list.append(button);
        }
        list.scrollTop = scroll;
        if (focusedId) $(focusedId)?.focus({preventScroll:true});
    }
    function render() {
        const l = labels();
        const status = $('board-status');
        status.textContent = state === 'ready' ? '' : l[state] || l.error;
        status.hidden = state === 'ready';
        $('board-new').hidden = !incoming;
        $('board-new').textContent = l.newMessages.replace('{count}', incoming);
        $('board-content').hidden = !data?.available || state === 'missing';
        if (!data?.available) return;
        const summary = data.board_summary || data.summary;
        $('board-summary').replaceChildren(...[['messages', l.messages], ['threads', l.topics], ['agents', l.agents]].map(([key, label]) => {
            const item = element('div', 'board-stat');
            item.append(element('strong', '', String(summary[key] || 0)), element('span', '', label));
            return item;
        }));
        options($('board-session'), data.boards.map(board => [board.id,
            (board.project || l.project) + ' · ' + (board.title || board.id.slice(-8))]), data.board_id);
        options($('board-channel'), data.channels.map(channel => [channel.name,
            channel.name + ' (' + channel.message_count + ')']), data.channel_name);
        const channel = data.channels.find(channel => channel.name === data.channel_name);
        $('board-channel').title = channel?.description || '';
        options($('board-author'), [['', l.allAuthors], ...data.authors.map(author => [author, author])], filters.author);
        renderTopics(); renderPosts();
        pager('board-topics', data.pagination || {offset:0, limit:20, total:0});
        pager('board-replies', data.reply_pagination || {offset:0, limit:20, total:0});
    }
    function translate(lang) {
        language = words[lang] ? lang : 'zh';
        panel.querySelectorAll('[data-board-text]').forEach(node => { node.textContent = labels()[node.dataset.boardText]; });
        $('office-board-button').querySelector('span')?.replaceChildren(document.createTextNode(labels().title));
        $('board-query').placeholder = labels().search;
        $('board-query').setAttribute('aria-label', labels().search);
        $('board-close').setAttribute('aria-label', labels().close);
        $('board-posts').setAttribute('aria-label', labels().discussion);
        render();
    }
    async function load(poll = false) {
        if (!open) return false;
        controller?.abort(); controller = new AbortController();
        const current = ++generation;
        if (!poll) { state = 'loading'; render(); }
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => { if (value !== '') params.set(key, value); });
        try {
            const response = await fetch('/api/agent-board?' + params, {cache:'no-store', signal:controller.signal});
            const next = await response.json();
            if (current !== generation || !open) return false;
            if (!response.ok || !next.ok) {
                if (response.status === 404) {
                    Object.assign(filters, {board:'', channel:'', thread:'', author:'', offset:0, reply_offset:0});
                    throw new Error('notFound');
                }
                throw new Error('error');
            }
            const summary = next.board_summary || next.summary;
            if (baseline === null || baseline.board !== next.board_id || !poll) {
                baseline = {board:next.board_id, messages:summary.messages || 0}; incoming = 0;
            } else incoming = Math.max(0, (summary.messages || 0) - baseline.messages);
            data = next;
            Object.assign(filters, {board:next.board_id, channel:next.channel_name, thread:next.thread_id});
            state = next.available ? 'ready' : 'missing';
            render(); return true;
        } catch (error) {
            if (current !== generation || !open || error.name === 'AbortError') return false;
            state = error.message === 'notFound' ? 'notFound' : 'error';
            render(); return false;
        }
    }
    function reset(fields) {
        Object.assign(filters, {thread:'', offset:0, reply_offset:0}, fields);
        return load(false);
    }
    $('board-session').addEventListener('change', () => reset({board:$('board-session').value, channel:'', author:''}));
    $('board-channel').addEventListener('change', () => reset({channel:$('board-channel').value, author:''}));
    $('board-author').addEventListener('change', () => reset({author:$('board-author').value}));
    $('board-search').addEventListener('submit', event => {
        event.preventDefault(); reset({query:$('board-query').value.trim()});
    });
    $('board-refresh').addEventListener('click', () => load(false));
    $('board-new').addEventListener('click', () => reset({channel:'', author:'', query:''}).then(() => { $('board-query').value = ''; }));
    for (const [prefix, key] of [['board-topics','offset'], ['board-replies','reply_offset']]) {
        for (const [suffix, direction] of [['previous',-1], ['next',1]]) {
            $(prefix + '-' + suffix).addEventListener('click', () => {
                const page = key === 'offset' ? data.pagination : data.reply_pagination;
                filters[key] = Math.max(0, page.offset + direction * page.limit);
                if (key === 'offset') { filters.thread = ''; filters.reply_offset = 0; }
                load(false);
            });
        }
    }
    panel.addEventListener('toggle', event => {
        open = event.newState === 'open';
        $('office-board-button').setAttribute('aria-expanded', String(open));
        if (open) { baseline = null; load(false); }
        else { generation++; controller?.abort(); }
        if (window.__TAURI__?.core) {
            const expanded = open || !!document.querySelector('.panel-collapsible:not(.collapsed), .office-panel:popover-open');
            window.__TAURI__.core.invoke('set_main_window_mode', {expanded}).catch(() => {});
        }
    });
    setInterval(() => { if (open && !document.hidden) load(true); }, 5000);
    document.addEventListener('visibilitychange', () => { if (open && !document.hidden) load(true); });
    window.AgentBoard = {translate, refresh:() => load(false)};
    translate(language);
    if (window.location.hash === '#agent-board') panel.showPopover();
})();
