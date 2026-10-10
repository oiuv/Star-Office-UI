const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const marked = require('../frontend/vendor/marked-18.1.0.umd.js');

const page = {offset:0, limit:20, total:1, has_more:false};
function sample() {
    return {ok:true, available:true, status:'ready', summary:{messages:3, threads:2, agents:2},
        board_summary:{messages:2, threads:1, agents:2},
        boards:[{id:'session-a',title:'留言板实现',project:'office'},{id:'session-b',title:'其他任务',project:'other'}],
        channels:[{name:'planning',description:'共享设计',message_count:2}],
        authors:['/root','/root/review'], board_id:'session-a',channel_name:'planning',thread_id:'topic-a',
        threads:[{id:'topic-a',author:'/root',preview:'讨论方案',reply_count:1,last_seq:2}],
        posts:[{id:'topic-a',thread_id:'topic-a',author:'/root',seq:1,created_at:'2026-10-10T08:00:00Z',text:'讨论方案'},
               {id:'reply-a',thread_id:'topic-a',author:'/root/review',seq:2,created_at:'2026-10-10T08:01:00Z',text:'已验证'}],
        pagination:{...page},reply_pagination:{...page}};
}
function fixture({desktop=false}={}) {
    let context;
    class Element {
        constructor(tag='div') { this.tag=tag; this.children=[]; this.listeners={}; this.dataset={}; this.attributes={}; this.textContent=''; this.value=''; this.className=''; this.scrollTop=0; this.hidden=false; }
        append(...items) { this.children.push(...items); }
        replaceChildren(...items) { this.children=[...items]; }
        addEventListener(name,listener) { this.listeners[name]=listener; }
        setAttribute(name,value) { this.attributes[name]=value; }
        contains(node) { return this===node || this.children.some(child=>child.contains(node)); }
        focus() { context.document.activeElement=this; }
        scrollIntoView(options) { this.scrollOptions=options; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        querySelectorAll(selector) {
            const all=this.children.flatMap(walk);
            if(selector==='span') return all.filter(node=>node.tag==='span');
            if(selector==='.board-copy') return all.filter(node=>node.className==='board-copy');
            if(selector==='[data-board-text]') return all.filter(node=>node.dataset.boardText);
            return [];
        }
        showPopover() { this.listeners.toggle?.({newState:'open'}); }
        set innerHTML(_) { throw new Error('Posts must not be parsed as HTML'); }
    }
    const walk=node=>[node,...node.children.flatMap(walk)];
    const html=fs.readFileSync('frontend/index.html','utf8');
    const block=html.slice(html.indexOf('<section id="agent-board-panel"'),html.indexOf('<section id="memo-panel"'));
    const nodes=new Map();
    for(const match of block.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const node=new Element(match[1]);node.id=match[3]; nodes.set(node.id,node);
        const label=match[2].match(/data-board-text="([^"]+)"/);
        if(label) node.dataset.boardText=label[1];
    }
    const panel=nodes.get('agent-board-panel'); panel.append(...[...nodes.values()].filter(node=>node!==panel));
    const invoker=new Element('button');invoker.id='office-board-button';invoker.append(new Element('span'));nodes.set(invoker.id,invoker);
    let result=sample(), fail=false, deferred=null;
    const requests=[], timers=[], copied=[], invocations=[];
    context={
        window:{marked,location:{hash:''},...(desktop?{__TAURI__:{core:{invoke:async(...args)=>invocations.push(args)}}}:{})},
        document:{hidden:false,activeElement:null,getElementById:id=>nodes.get(id)||[...nodes.values()].flatMap(walk).find(node=>node.id===id),
            createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element();node.textContent=text;return node;},
            querySelector:()=>null,addEventListener(){}},
        navigator:{clipboard:{writeText:async text=>copied.push(text)}},
        localStorage:{getItem:()=>null},AbortController,URLSearchParams,URL,
        setInterval:callback=>{timers.push(callback);return timers.length;},
        fetch:async(url,options)=>{
            requests.push({url,options});
            if(deferred) return deferred;
            if(fail) throw new Error('offline');
            return {ok:true,status:200,json:async()=>structuredClone(result)};
        }
    };
    vm.runInNewContext(fs.readFileSync('frontend/office-markdown.js','utf8'),context);
    vm.runInNewContext(fs.readFileSync('frontend/agent-board.js','utf8'),context);
    const settle=()=>new Promise(setImmediate);
    const text=node=>[node.textContent,...node.children.map(text)].join(' ');
    return {nodes,context,requests,copied,invocations,
        set:value=>{result=value;},fail:value=>{fail=value;},defer:promise=>{deferred=promise;},
        async open(){panel.showPopover();await settle();},
        async close(){panel.listeners.toggle({newState:'closed'});await settle();},
        async poll(){timers[0]();await settle();},
        async event(id,name='click',event={preventDefault(){}}){await nodes.get(id).listeners[name](event);await settle();},
        translate:lang=>context.window.AgentBoard.translate(lang),
        text:id=>text(nodes.get(id)),walk,settle};
}

test('The board only fetches while open and pauses polling when closed or hidden',async()=>{
    const f=fixture();
    await f.poll(); assert.equal(f.requests.length,0);
    await f.open(); assert.equal(f.requests.length,1);
    await f.poll(); assert.equal(f.requests.length,2);
    f.context.document.hidden=true;await f.poll();assert.equal(f.requests.length,2);
    await f.close(); f.context.document.hidden=false;await f.poll();assert.equal(f.requests.length,2);
    assert.equal(f.requests[0].options.cache,'no-store');
});

test('Raw HTML stays literal while Markdown code blocks can be copied',async()=>{
    const f=fixture(),data=sample();
    data.posts[1].text='<img src=x onerror=alert(1)>\n\n```js\nconst a = "<script>";\n```';
    f.set(data);await f.open();
    assert.ok(f.text('board-posts').includes('<img src=x onerror=alert(1)>'));
    const copy=f.walk(f.nodes.get('board-posts')).find(node=>node.className==='board-copy');
    await copy.listeners.click();
    assert.deepEqual(f.copied,['const a = "<script>";']);
    assert.equal(copy.textContent,'已复制');
    assert.ok(f.text('board-summary').includes('参与 Agent'));
});

test('The original and replies have distinct labels and sections; the shortcut moves reading focus',async()=>{
    const f=fixture();await f.open();
    const nodes=f.walk(f.nodes.get('board-posts'));
    const original=nodes.find(node=>node.id==='board-post-topic-a');
    const reply=nodes.find(node=>node.id==='board-post-reply-a');
    assert.equal(original.dataset.kind,'topic');assert.equal(reply.dataset.kind,'reply');
    assert.match(original.className,/board-original/);assert.match(reply.className,/board-reply/);
    assert.match(original.attributes['aria-label'],/主题帖/);
    assert.match(reply.attributes['aria-label'],/1楼/);
    const section=nodes.find(node=>node.className==='board-replies');
    assert.ok(section.contains(reply));assert.ok(!section.contains(original));
    assert.match(f.text('board-posts'),/回复（1）/);
    const jump=nodes.find(node=>node.id==='board-replies-jump');
    assert.match(jump.textContent,/查看回复（1）/);
    jump.listeners.click();
    const heading=nodes.find(node=>node.id==='board-replies-heading');
    assert.equal(heading.scrollOptions.block,'start');
    assert.equal(f.context.document.activeElement,heading);
});

test('Reply numbering continues across pages and count changes update the reply heading',async()=>{
    const f=fixture(),data=sample();data.reply_pagination={...page,offset:20,total:45};
    f.set(data);await f.open();
    assert.match(f.text('board-posts'),/21楼/);
    assert.match(f.text('board-posts'),/回复（45）/);
    data.reply_pagination.total=46;f.set(data);await f.poll();
    assert.match(f.text('board-posts'),/回复（46）/);
    f.translate('en');assert.match(f.text('board-posts'),/Original post/);
    assert.match(f.text('board-posts'),/#21/);assert.match(f.text('board-posts'),/Replies \(46\)/);
    f.translate('ja');assert.match(f.text('board-posts'),/トピック/);assert.match(f.text('board-posts'),/#21/);
});

test('A topic without replies has a clear empty reply section and no jump control',async()=>{
    const f=fixture(),data=sample();data.posts=data.posts.slice(0,1);
    data.reply_pagination={...page,total:0};f.set(data);await f.open();
    assert.match(f.text('board-posts'),/回复（0）/);
    assert.match(f.text('board-posts'),/暂无回复/);
    assert.ok(!f.walk(f.nodes.get('board-posts')).some(node=>node.id==='board-replies-jump'));
});

test('Markdown formats headings, nested lists, task lists, quotes, tables and inline emphasis',async()=>{
    const f=fixture(),data=sample();
    data.posts[0].text='# 模块地图\n\n## 关系\n\n**依赖**、*调用*、~~旧项~~ 与 `core`。\n\n'
        +'> 只读研究\n\n3. 第一项\n   - 子项\n4. 第二项\n\n- [x] 已完成\n- [ ] 待验证\n\n'
        +'| 模块 | 数量 |\n|:---|---:|\n| core | **2** |\n\n---\n\n换行  \n下一行';
    f.set(data);await f.open();
    const nodes=f.walk(f.nodes.get('board-posts'));
    for(const tag of ['h1','h2','strong','em','del','code','blockquote','ol','ul','li','table','thead','tbody','th','td','hr','br']) {
        assert.ok(nodes.some(node=>node.tag===tag),'missing '+tag);
    }
    assert.equal(nodes.find(node=>node.tag==='ol').start,3);
    const checks=nodes.filter(node=>node.tag==='input');
    assert.equal(checks.length,2);assert.ok(checks.every(node=>node.disabled));
    assert.deepEqual(checks.map(node=>node.checked),[true,false]);
    assert.ok(nodes.some(node=>node.tag==='th'&&node.className==='board-align-right'));
    assert.ok(nodes.some(node=>node.tag==='div'&&node.className==='board-table'&&node.tabIndex===0));
    assert.ok(!f.text('board-posts').includes('**依赖**'));
});

test('Markdown links reject executable URLs and images do not load remote content',async()=>{
    const f=fixture(),data=sample();
    data.posts[0].text='[安全 **链接**](https://example.com/docs "文档") [危险](javascript:alert%281%29) '
        +'[数据](data:text/html,bad) [本地](file:///C:/private/file) ![图示](https://example.com/image.png)\n\n'
        +'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>';
    f.set(data);await f.open();
    const nodes=f.walk(f.nodes.get('board-posts')),links=nodes.filter(node=>node.tag==='a');
    assert.deepEqual(links.map(node=>node.href),['https://example.com/docs','https://example.com/image.png']);
    assert.ok(links.every(node=>node.target==='_blank'&&node.rel==='noopener noreferrer'));
    assert.equal(links[0].title,'文档');
    assert.ok(!nodes.some(node=>['img','script','iframe','style'].includes(node.tag)));
    assert.ok(f.text('board-posts').includes('<script>alert(1)</script>'));
    assert.ok(f.text('board-posts').includes('危险'));
});

test('Markdown entities display once and inline code keeps its original characters',async()=>{
    const f=fixture(),data=sample();
    data.posts[0].text='&lt;tag&gt; &amp; &amp;lt; &#60; &#x1F431; `&amp; <tag>`';
    f.set(data);await f.open();
    assert.ok(f.text('board-posts').includes('<tag> & &lt; < 🐱'));
    const code=f.walk(f.nodes.get('board-posts')).find(node=>node.tag==='code');
    assert.equal(code.textContent,'&amp; <tag>');
});

test('A missing Markdown parser still shows readable post content',async()=>{
    const f=fixture(),data=sample();data.posts[0].text='# 原始内容\n**仍然可以阅读**';
    f.context.window.marked=undefined;f.set(data);await f.open();
    assert.ok(f.text('board-posts').includes(data.posts[0].text));
    assert.equal(f.nodes.get('board-status').hidden,true);
});

test('Search and author changes send exact filters and reset both pages',async()=>{
    const f=fixture();await f.open();
    f.nodes.get('board-query').value='已验证';
    await f.event('board-search','submit');
    let params=new URLSearchParams(f.requests.at(-1).url.split('?')[1]);
    assert.equal(params.get('query'),'已验证');assert.equal(params.get('board'),'session-a');
    f.nodes.get('board-author').value='/root/review';
    await f.event('board-author','change');
    params=new URLSearchParams(f.requests.at(-1).url.split('?')[1]);
    assert.equal(params.get('author'),'/root/review');
    assert.equal(params.get('offset'),'0');assert.equal(params.get('reply_offset'),'0');
});

test('Refreshing and incoming replies preserve reader scroll and keyboard focus',async()=>{
    const f=fixture();await f.open();
    const posts=f.nodes.get('board-posts');posts.scrollTop=127;
    f.nodes.get('board-discussion-title').focus();
    const data=sample();data.board_summary.messages=3;
    data.posts.push({...data.posts[1],id:'reply-b',seq:3,text:'补充建议'});
    f.set(data);await f.poll();
    assert.equal(posts.scrollTop,127);
    assert.equal(f.context.document.activeElement,f.nodes.get('board-discussion-title'));
    assert.equal(f.nodes.get('board-new').hidden,false);
    assert.match(f.nodes.get('board-new').textContent,/新增 1 条/);
    await f.event('board-new');assert.equal(f.nodes.get('board-new').hidden,true);
});

test('An unchanged poll leaves code controls and selection DOM intact',async()=>{
    const f=fixture(),data=sample();data.posts[0].text='```\nhello\n```';f.set(data);await f.open();
    const original=f.nodes.get('board-posts').children[0];
    const copy=f.walk(original).find(node=>node.className==='board-copy');copy.focus();
    await f.poll();
    assert.equal(f.nodes.get('board-posts').children[0],original);
    assert.equal(f.context.document.activeElement,copy);
});

test('Reply pagination retains the topic and topic pagination clears reply offset',async()=>{
    const f=fixture(),data=sample();
    data.pagination={...page,total:25,has_more:true};data.reply_pagination={...page,total:23,has_more:true};
    f.set(data);await f.open();await f.event('board-replies-next');
    let params=new URLSearchParams(f.requests.at(-1).url.split('?')[1]);
    assert.equal(params.get('thread'),'topic-a');assert.equal(params.get('reply_offset'),'20');
    await f.event('board-topics-next');params=new URLSearchParams(f.requests.at(-1).url.split('?')[1]);
    assert.equal(params.get('offset'),'20');assert.equal(params.get('reply_offset'),'0');assert.equal(params.has('thread'),false);
});

test('Language changes keep discussion content and translate search, metadata and code actions',async()=>{
    const f=fixture(),data=sample();data.posts[0].text='```\nhello\n```';f.set(data);await f.open();
    f.translate('en');assert.ok(f.text('board-posts').includes('Main agent'));
    assert.ok(f.text('board-posts').includes('Copy code'));assert.ok(f.text('board-posts').includes('已验证'));
    assert.equal(f.nodes.get('board-query').attributes['aria-label'],'Search posts and replies');
    f.translate('ja');assert.ok(f.text('board-posts').includes('コードをコピー'));
});

test('Errors preserve readable content and recover with Refresh; missing board has an explicit message',async()=>{
    const f=fixture();await f.open();f.fail(true);await f.poll();
    assert.ok(f.text('board-posts').includes('已验证'));assert.match(f.text('board-status'),/刷新重试/);
    f.fail(false);await f.event('board-refresh');assert.equal(f.nodes.get('board-status').hidden,true);
    f.set({ok:true,available:false,status:'missing',summary:{},boards:[],channels:[],authors:[],threads:[],posts:[],board_id:'',channel_name:'',thread_id:''});
    await f.event('board-refresh');assert.match(f.text('board-status'),/未找到/);assert.equal(f.nodes.get('board-content').hidden,true);
});

test('A response arriving after close cannot overwrite the current view',async()=>{
    const f=fixture();await f.open();
    const before=f.text('board-posts');let resolve;
    f.defer(new Promise(done=>{resolve=done;}));
    await f.poll();await f.close();
    const changed=sample();changed.posts[0].text='Stale response';
    resolve({ok:true,json:async()=>changed});await f.settle();
    assert.equal(f.text('board-posts'),before);
});

test('Desktop board toggle expands the native window and collapses it on close',async()=>{
    const f=fixture({desktop:true});await f.open();await f.close();
    assert.equal(f.invocations[0][0],'set_main_window_mode');assert.equal(f.invocations[0][1].expanded,true);
    assert.equal(f.invocations.at(-1)[1].expanded,false);
});

test('Browser and desktop include the shared popover, script, stylesheet and language bridge',()=>{
    for(const filename of ['frontend/index.html','frontend/electron-standalone.html']) {
        const html=fs.readFileSync(filename,'utf8');
        assert.equal((html.match(/id="agent-board-panel"/g)||[]).length,1);
        assert.match(html,/id="agent-board-panel"[^>]*popover="auto"/);
        assert.match(html,/agent-board\.js/);assert.match(html,/agent-board\.css/);
        assert.ok(html.indexOf('marked-18.1.0.umd.js')<html.indexOf('agent-board.js'));
        assert.match(html,/vendor\/marked-18\.1\.0\.umd\.js/);
        assert.match(html,/window\.AgentBoard\.translate\(uiLang\)/);
    }
});


test('Copy full text preserves the topic Markdown exactly and excludes replies and UI labels',async()=>{
    const f=fixture(),data=sample();
    const source='  # 主题 🐱\r\n\r\n**正文** &amp; [链接](https://example.com)\r\n\r\n```js\r\n\tconst value = "<tag>";\r\n```\r\n';
    data.posts[0].text=source;f.set(data);await f.open();
    const copies=f.walk(f.nodes.get('board-posts')).filter(node=>node.className==='board-post-copy');
    assert.equal(copies.length,1);assert.equal(copies[0].textContent,'复制全文');
    assert.equal(copies[0].type,'button');
    await copies[0].listeners.click();
    assert.deepEqual(f.copied,[source]);assert.equal(copies[0].textContent,'已复制');
    assert.equal(copies[0].disabled,false);
    const code=f.walk(f.nodes.get('board-posts')).find(node=>node.className==='board-copy');
    await code.listeners.click();
    assert.equal(f.copied[1],'\tconst value = "<tag>";');
});

test('A denied clipboard shows a retryable full-text error without replacing the post',async()=>{
    const f=fixture();await f.open();
    const copy=f.walk(f.nodes.get('board-posts')).find(node=>node.className==='board-post-copy');
    f.context.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
    await copy.listeners.click();
    assert.equal(copy.textContent,'复制失败，请选中正文复制');assert.equal(copy.disabled,false);
    assert.ok(f.text('board-posts').includes('讨论方案'));
    f.context.navigator.clipboard.writeText=async text=>f.copied.push(text);
    await copy.listeners.click();assert.deepEqual(f.copied,['讨论方案']);assert.equal(copy.textContent,'已复制');
});

test('Unreadable topics cannot be copied and truncated topics label the available text honestly',async()=>{
    const f=fixture(),data=sample();data.posts[0].unreadable=true;f.set(data);await f.open();
    assert.ok(!f.walk(f.nodes.get('board-posts')).some(node=>node.className==='board-post-copy'));
    data.posts[0].unreadable=false;data.posts[0].truncated=true;f.set(data);await f.poll();
    const copy=f.walk(f.nodes.get('board-posts')).find(node=>node.className==='board-post-copy');
    assert.equal(copy.textContent,'复制已显示正文');await copy.listeners.click();
    assert.deepEqual(f.copied,['讨论方案']);
});

test('Full-text actions translate and retain keyboard focus when replies arrive',async()=>{
    const f=fixture();await f.open();
    const findCopy=()=>f.walk(f.nodes.get('board-posts')).find(node=>node.className==='board-post-copy');
    findCopy().focus();const data=sample();data.posts.push({...data.posts[1],id:'reply-b',text:'新的回复'});
    f.set(data);await f.poll();assert.equal(f.context.document.activeElement,findCopy());
    f.translate('en');assert.equal(findCopy().textContent,'Copy full text');
    f.translate('ja');assert.equal(findCopy().textContent,'全文をコピー');
    await findCopy().listeners.click();assert.equal(findCopy().textContent,'コピー済み');
    assert.deepEqual(f.copied,['讨论方案']);
});
