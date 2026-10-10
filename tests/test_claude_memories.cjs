const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const marked = require('../frontend/vendor/marked-18.1.0.umd.js');

function fixture() {
    class Element {
        constructor(tag='div') { this.tag=tag; this.children = []; this.textContent = ''; this.className = ''; this.attributes={}; this.listeners={}; }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = [...nodes]; }
        addEventListener(name,listener) { this.listeners[name]=listener; }
        setAttribute(name,value) { this.attributes[name]=value; }
        hasAttribute() { return true; }
        get childElementCount() { return this.children.length; }
        set innerHTML(_) { throw new Error('Memo content must never be parsed as HTML'); }
    }
    const nodes = new Map(['claude-memories-panel', 'claude-memories-content', 'claude-memories-date'].map(id => [id, new Element()]));
    let response = {success: true, entries: []};
    let failed = false;
    const copied=[];
    const context = {
        window: {marked}, URL, navigator:{clipboard:{writeText:async text=>copied.push(text)}},
        document: {getElementById: id => nodes.get(id), createElement: tag => new Element(tag), createTextNode:text=>{const n=new Element('text');n.textContent=text;return n;}},
        fetch: async () => { if (failed) throw new Error('offline'); return {ok: true, json: async () => response}; }
    };
    vm.runInNewContext(fs.readFileSync('frontend/office-markdown.js', 'utf8'), context);
    vm.runInNewContext(fs.readFileSync('frontend/claude-memories.js', 'utf8'), context);
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    const walk=n=>[n,...n.children.flatMap(walk)];
    return {nodes,copied,walk,context,memo: context.window.ClaudeMemories, set: entries => { response = {success: true, entries}; }, fail: value => { failed = value; }, text: () => text(nodes.get('claude-memories-content'))};
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

test('complete Markdown memories render headings, lists, tables, code and the final paragraph', async()=>{
    const f=fixture(), longText='完整正文'.repeat(100);
    const body='# 工作规则\n\n**重点** 与 `code`\n\n- 一条\n- 二条\n\n> 备注\n\n| 名称 | 状态 |\n| --- | --- |\n| office | done |\n\n```js\nconst result = 42;\n```\n\n'+longText+'\n\n最后一段。';
    f.set([{...entry,text:body}]);await f.memo.load('zh');
    const nodes=f.walk(f.nodes.get('claude-memories-content'));
    for(const tag of ['h1','strong','code','ul','li','blockquote','table','th','td','pre']) {
        assert.ok(nodes.some(n=>n.tag===tag),tag);
    }
    assert.ok(f.text().includes(longText));assert.ok(f.text().includes('最后一段。'));
    const button=nodes.find(n=>n.className==='board-copy');await button.listeners.click();
    assert.deepEqual(f.copied,['const result = 42;']);assert.equal(button.textContent,'已复制');
});
test('all returned memories and the total count are displayed',async()=>{
    const f=fixture();f.set(Array.from({length:14},(_,i)=>({...entry,title:'记忆 '+i})));
    await f.memo.load('zh');assert.equal(f.nodes.get('claude-memories-content').children.length,14);
    assert.ok(f.text().includes('记忆 13'));
    assert.ok(f.nodes.get('claude-memories-date').textContent.includes('共 14 条记忆'));
    f.memo.translate('en');assert.ok(f.nodes.get('claude-memories-date').textContent.includes('14 memories'));
});
test('memory Markdown keeps raw HTML literal and rejects executable links',async()=>{
    const f=fixture();
    f.set([{...entry,text:'<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29) [文档](https://example.com/docs)'}]);
    await f.memo.load('zh');
    const nodes=f.walk(f.nodes.get('claude-memories-content'));
    assert.ok(!nodes.some(n=>['img','script','iframe'].includes(n.tag)));
    assert.deepEqual(nodes.filter(n=>n.tag==='a').map(n=>n.href),['https://example.com/docs']);
    assert.ok(f.text().includes('<img src=x onerror=alert(1)>'));
});
test('missing Markdown tokenizer still displays the complete body',async()=>{
    const f=fixture();f.context.window.marked=undefined;
    const text='# 原始记忆\n\n'+('保留完整内容'.repeat(60))+'\n结尾';
    f.set([{...entry,text}]);await f.memo.load('zh');assert.ok(f.text().includes(text));
});
test('browser and desktop load the shared Markdown assets before memory rendering',()=>{
    for(const file of ['frontend/index.html','frontend/electron-standalone.html']) {
        const html=fs.readFileSync(file,'utf8');
        assert.ok(html.includes('/static/office-markdown.css'));
        assert.ok(html.indexOf('/static/vendor/marked-18.1.0.umd.js') < html.indexOf('/static/office-markdown.js'));
        assert.ok(html.indexOf('/static/office-markdown.js') < html.indexOf('/static/claude-memories.js'));
    }
});
