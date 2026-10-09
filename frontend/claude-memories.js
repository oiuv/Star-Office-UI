/* A shared, read-only view for the browser and Electron office. */
(() => {
    'use strict';
    const words = {
        zh: { source: 'Claude · 各项目记忆按更新时间排序', empty: '暂无 Claude 记忆', loading: '正在读取最近记忆…', error: '最近记忆加载失败，请稍后重新打开', project: '未标注项目', updated: '记忆更新' },
        en: { source: 'Claude · Latest memory updates across projects', empty: 'No Claude memories yet', loading: 'Loading recent memories…', error: 'Could not load memories. Reopen to retry.', project: 'Unspecified project', updated: 'Memory updated' },
        ja: { source: 'Claude · プロジェクト横断で更新順', empty: 'Claude のメモリはまだありません', loading: '最近のメモリを読み込み中…', error: '読み込めませんでした。開き直して再試行してください。', project: 'プロジェクト未指定', updated: 'メモリ更新' }
    };
    const panel = document.getElementById('claude-memories-panel');
    const content = document.getElementById('claude-memories-content');
    const caption = document.getElementById('claude-memories-date');
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
            const message = element('div', 'claude-memories-placeholder', labels[state === 'ready' ? 'empty' : state]);
            message.id = 'claude-memories-placeholder';
            content.append(message);
            return;
        }
        for (const entry of entries) {
            const article = element('article', 'claude-memories-entry', '');
            const meta = element('div', 'claude-memories-meta', '');
            const date = element('time', 'claude-memories-time', labels.updated + ' · ' + entry.date);
            date.dateTime = entry.updated_at;
            meta.append(element('span', 'claude-memories-project', entry.project || labels.project), date);
            article.append(meta, element('h3', 'claude-memories-title', entry.title));
            if (entry.text) article.append(element('p', 'claude-memories-text', entry.text));
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
                const response = await fetch('/claude-memories', {cache: 'no-store'});
                const data = await response.json();
                if (!response.ok || !data.success || !Array.isArray(data.entries)) throw new Error('Invalid claude memories response');
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
    window.ClaudeMemories = {load, translate};
    panel.addEventListener('toggle', event => { if (event.newState === 'open') load(); });
    // Electron uses collapsible panels instead of browser popovers.
    if (!panel.hasAttribute('popover')) document.getElementById('claude-memories-title').addEventListener('click', () => load());
})();
