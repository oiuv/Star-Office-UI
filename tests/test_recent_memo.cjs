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
    const nodes = new Map(['memo-panel', 'memo-content', 'memo-date'].map(id => [id, new Element()]));
    let response = {success: true, entries: []};
    let failed = false;
    const context = {
        window: {}, document: {getElementById: id => nodes.get(id), createElement: () => new Element()},
        fetch: async () => { if (failed) throw new Error('offline'); return {ok: true, json: async () => response}; }
    };
    vm.runInNewContext(fs.readFileSync('frontend/recent-memo.js', 'utf8'), context);
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    return {memo: context.window.RecentMemo, set: entries => { response = {success:true, entries}; }, fail: value => { failed = value; }, text: () => text(nodes.get('memo-content'))};
}
const entry = {date:'2026-10-04', updated_at:'2026-10-04T10:00:00Z', project:'office', title:'菜单更新', tasks:[{title:'验证手机布局', outcome:'partial'}]};

test('Summary text is rendered literally, including HTML-like titles', async () => {
    const f = fixture();
    const title = '<img src=x onerror=alert(1)>';
    f.set([{...entry, title}]);
    await f.memo.load('zh');
    assert.match(f.text(), /2026-10-04/);
    assert.ok(f.text().includes(title));
    assert.match(f.text(), /部分完成/);
});

test('Language changes preserve summaries and translate their outcome labels', async () => {
    const f = fixture(); f.set([entry]); await f.memo.load('zh');
    f.memo.translate('en');
    assert.match(f.text(), /Partial/);
    assert.match(f.text(), /验证手机布局/);
    f.memo.translate('ja');
    assert.match(f.text(), /一部完了/);
});

test('Refreshing empty results clears old summaries', async () => {
    const f = fixture(); f.set([entry]); await f.memo.load('zh');
    f.set([]); await f.memo.load();
    assert.match(f.text(), /暂无 Codex 会话总结/);
    assert.doesNotMatch(f.text(), /菜单更新/);
});

test('Load errors can recover on the next open', async () => {
    const f = fixture(); f.fail(true); await f.memo.load('en');
    assert.match(f.text(), /Could not load/);
    f.fail(false); f.set([entry]); await f.memo.load();
    assert.match(f.text(), /菜单更新/);
    assert.doesNotMatch(f.text(), /Could not load/);
});
