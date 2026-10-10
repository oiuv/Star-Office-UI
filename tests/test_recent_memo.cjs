const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const marked = require('../frontend/vendor/marked-18.1.0.umd.js');

function fixture() {
    class Element {
        constructor(tag='div') { this.tag=tag; this.children=[]; this.textContent=''; this.className=''; this.dataset={}; this.attributes={}; this.listeners={}; }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = [...nodes]; }
        addEventListener(name, listener) { this.listeners[name]=listener; }
        setAttribute(name,value) { this.attributes[name]=value; }
        hasAttribute() { return true; }
        get childElementCount() { return this.children.length; }
        set innerHTML(_) { throw new Error('Memo content must never be parsed as HTML'); }
    }
    const nodes = new Map(['memo-panel', 'memo-content', 'memo-date'].map(id => [id, new Element()]));
    let response = {success: true, entries: []};
    let failed = false;
    const copied=[];
    const context = {
        window: {marked}, URL, navigator:{clipboard:{writeText:async text=>copied.push(text)}},
        document: {getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),createTextNode:text=>{const n=new Element('text');n.textContent=text;return n;}},
        fetch: async () => { if (failed) throw new Error('offline'); return {ok: true, json: async () => response}; }
    };
    vm.runInNewContext(fs.readFileSync('frontend/office-markdown.js', 'utf8'), context);
    vm.runInNewContext(fs.readFileSync('frontend/recent-memo.js', 'utf8'), context);
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    const walk=n=>[n,...n.children.flatMap(walk)];
    return {nodes,copied,walk,context,memo: context.window.RecentMemo, set: entries => { response = {success:true, entries}; }, fail: value => { failed = value; }, text: () => text(nodes.get('memo-content'))};
}
const entry = {date:'2026-10-04', updated_at:'2026-10-04T10:00:00Z', project:'office', title:'菜单更新', text:'## Task 1: 验证手机布局\n\nOutcome: partial', tasks:[{title:'验证手机布局', outcome:'partial'}]};

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

test('complete Codex Markdown keeps long body and code and table formatting',async()=>{
    const f=fixture(), longText='完整正文'.repeat(100);
    f.set([{...entry,text:'## 实施记录\n\n**重点**\n\n- 改动\n- 验证\n\n| 名称 | 状态 |\n| --- | --- |\n| office | done |\n\n```js\nconst complete = true;\n```\n\n'+longText+'\n最后一段。'}]);
    await f.memo.load('zh');
    const nodes=f.walk(f.nodes.get('memo-content'));
    for(const tag of ['h2','strong','ul','li','table','th','td','pre','code']) assert.ok(nodes.some(n=>n.tag===tag),tag);
    assert.ok(f.text().includes(longText));assert.ok(f.text().includes('最后一段。'));
    await nodes.find(n=>n.className==='board-copy').listeners.click();
    assert.deepEqual(f.copied,['const complete = true;']);
});
test('all returned summaries and their total count are shown',async()=>{
    const f=fixture();f.set(Array.from({length:7},(_,i)=>({...entry,title:'小记 '+i})));
    await f.memo.load('zh');assert.equal(f.nodes.get('memo-content').children.length,7);
    assert.ok(f.text().includes('小记 6'));
    assert.ok(f.nodes.get('memo-date').textContent.includes('共 7 份小记'));
});
test('task outcomes are counted across every task and translate without losing the full body',async()=>{
    const f=fixture();f.set([{...entry,tasks:['success','success','partial','failed','unknown'].map((outcome,i)=>({title:'任务 '+i,outcome}))}]);
    await f.memo.load('zh');
    assert.ok(f.text().includes('已完成 · 2'));assert.ok(f.text().includes('未完成 · 1'));
    f.memo.translate('en');assert.ok(f.text().includes('Completed · 2'));assert.ok(f.text().includes('Unconfirmed · 1'));
    assert.ok(f.text().includes('验证手机布局'));
});
test('summary HTML stays literal and executable Markdown links are rejected',async()=>{
    const f=fixture();f.set([{...entry,text:'<script>alert(1)</script>\n\n[危险](javascript:alert%281%29) [文档](https://example.com/docs)'}]);
    await f.memo.load('zh');
    const nodes=f.walk(f.nodes.get('memo-content'));
    assert.ok(!nodes.some(n=>['script','img','iframe'].includes(n.tag)));
    assert.deepEqual(nodes.filter(n=>n.tag==='a').map(n=>n.href),['https://example.com/docs']);
    assert.ok(f.text().includes('<script>alert(1)</script>'));
});
test('a missing Markdown tokenizer leaves complete summary text readable',async()=>{
    const f=fixture();f.context.window.marked=undefined;
    const text='## 原始内容\n'+('完整'.repeat(180))+'\n最后';
    f.set([{...entry,text}]);await f.memo.load('zh');assert.ok(f.text().includes(text));
});
test('both office pages load shared Markdown before Codex notes and expose keyboard scrolling',()=>{
    for(const path of ['frontend/index.html','frontend/electron-standalone.html']) {
        const html=fs.readFileSync(path,'utf8');
        assert.ok(html.indexOf('/static/office-markdown.js')<html.indexOf('/static/recent-memo.js'));
        assert.ok(html.includes('id="memo-content" tabindex="0"'));
    }
});
