const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    class Element {
        constructor() { this.children = []; this.textContent = ''; this.className = ''; }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = [...nodes]; }
        addEventListener() {}
        hasAttribute() { return true; }
        get childElementCount() { return this.children.length; }
        set innerHTML(_) { throw new Error('Memo content must never be parsed as HTML'); }
    }
    const nodes = new Map(['claude-memories-panel', 'claude-memories-content', 'claude-memories-date'].map(id => [id, new Element()]));
    let response = {success: true, entries: []};
    let failed = false;
    const context = {
        window: {}, document: {getElementById: id => nodes.get(id), createElement: () => new Element()},
        fetch: async () => { if (failed) throw new Error('offline'); return {ok: true, json: async () => response}; }
    };
    vm.runInNewContext(fs.readFileSync('frontend/claude-memories.js', 'utf8'), context);
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    return {memo: context.window.ClaudeMemories, set: entries => { response = {success: true, entries}; }, fail: value => { failed = value; }, text: () => text(nodes.get('claude-memories-content'))};
}
const entry = {date: '2026-10-09', updated_at: '2026-10-09T10:00:00Z', project: 'C--AI-Star-Office-UI', title: '提交规范', text: '不加署名。'};

test('Memory entries are rendered literally, including HTML-like titles', async () => {
    const f = fixture();
    const title = '<img src=x onerror=alert(1)>';
    f.set([{...entry, title}]);
    await f.memo.load('zh');
    assert.match(f.text(), /2026-10-09/);
    assert.ok(f.text().includes(title));
    assert.match(f.text(), /C--AI-Star-Office-UI/);
    assert.match(f.text(), /不加署名/);
});

test('Language changes preserve entries and translate their labels', async () => {
    const f = fixture(); f.set([entry]); await f.memo.load('zh');
    f.memo.translate('en');
    assert.match(f.text(), /Memory updated/);
    assert.ok(f.text().includes('提交规范'));
    f.memo.translate('ja');
    assert.match(f.text(), /メモリ更新/);
});

test('Refreshing empty results clears old entries', async () => {
    const f = fixture(); f.set([entry]); await f.memo.load('zh');
    f.set([]);
    await f.memo.load();
    assert.match(f.text(), /暂无 Claude 记忆/);
    assert.doesNotMatch(f.text(), /提交规范/);
});

test('Load errors can recover on the next open', async () => {
    const f = fixture(); f.fail(true); await f.memo.load('en');
    assert.match(f.text(), /Could not load/);
    f.fail(false); f.set([entry]); await f.memo.load();
    assert.match(f.text(), /提交规范/);
    assert.doesNotMatch(f.text(), /Could not load/);
});
