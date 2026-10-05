/* A shared, read-only view for the browser and Electron office. */
(() => {
    'use strict';
    const words = {
        zh: { source: 'Codex · 按总结更新时间排序', empty: '暂无 Codex 会话总结', loading: '正在读取会话总结…', error: '会话总结加载失败，请稍后重新打开', project: '未标注项目', updated: '总结更新', success: '已完成', partial: '部分完成', failed: '未完成', unknown: '待确认' },
        en: { source: 'Codex · Latest summary updates', empty: 'No Codex session summaries yet', loading: 'Loading session summaries…', error: 'Could not load summaries. Reopen to retry.', project: 'Unspecified project', updated: 'Summary updated', success: 'Completed', partial: 'Partial', failed: 'Failed', unknown: 'Unconfirmed' },
        ja: { source: 'Codex · 要約の更新順', empty: 'Codex の会話要約はまだありません', loading: '会話要約を読み込み中…', error: '読み込めませんでした。開き直して再試行してください。', project: 'プロジェクト未指定', updated: '要約更新', success: '完了', partial: '一部完了', failed: '未完了', unknown: '未確認' }
    };
    const panel = document.getElementById('memo-panel');
    const content = document.getElementById('memo-content');
    const caption = document.getElementById('memo-date');
    let language = 'zh', entries = [], state = 'loading', pending = null;
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    };
    function render() {
        const labels = words[language] || words.zh;
        caption.textContent = labels.source;
        content.replaceChildren();
        if (state !== 'ready' || !entries.length) {
            const message = element('div', 'recent-memo-placeholder', labels[state === 'ready' ? 'empty' : state]);
            message.id = 'memo-placeholder';
            content.append(message);
            return;
        }
        for (const entry of entries) {
            const article = element('article', 'recent-memo-entry', '');
            const meta = element('div', 'recent-memo-meta', '');
            const date = element('time', 'recent-memo-time', labels.updated + ' · ' + entry.date);
            date.dateTime = entry.updated_at;
            meta.append(element('span', 'recent-memo-project', entry.project || labels.project), date);
            article.append(meta, element('h3', 'recent-memo-title', entry.title));
            const tasks = element('ul', 'recent-memo-tasks', '');
            for (const task of entry.tasks || []) {
                const item = element('li', '', '');
                item.append(element('span', '', task.title));
                if (labels[task.outcome]) item.append(element('span', 'recent-memo-outcome', labels[task.outcome]));
                tasks.append(item);
            }
            if (tasks.childElementCount) article.append(tasks);
            content.append(article);
        }
    }
    function translate(lang) {
        language = words[lang] ? lang : 'zh';
        render();
    }
    function load(lang = language) {
        translate(lang);
        if (pending) return pending;
        state = 'loading';
        render();
        pending = (async () => {
            try {
                const response = await fetch('/recent-memo', {cache: 'no-store'});
                const data = await response.json();
                if (!response.ok || !data.success || !Array.isArray(data.entries)) throw new Error('Invalid memo response');
                entries = data.entries;
                state = 'ready';
            } catch (_) {
                entries = [];
                state = 'error';
            } finally {
                pending = null;
                render();
            }
        })();
        return pending;
    }
    window.RecentMemo = {load, translate};
    panel.addEventListener('toggle', event => { if (event.newState === 'open') load(); });
    // Electron uses collapsible panels instead of browser popovers.
    if (!panel.hasAttribute('popover')) document.getElementById('memo-title').addEventListener('click', () => load());
})();
