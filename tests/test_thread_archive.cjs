const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function sample() {
    return {ok:true, available:true, summary:{threads:21,tokens_used:4777736001},
        filtered_summary:{threads:21,tokens_used:4777736001},
        facets:{sources:[{value:'user',count:20},{value:'future_feature',count:1}],
                models:[{value:'gpt-6-astra',count:21}],projects:[{value:'office',count:21}]},
        pagination:{offset:0,limit:20,total:21},
        threads:[{id:'s1',title:'<script>alert(1)</script>',preview:'摘要 <img src=x>',
            tokens_used:4777736001,thread_source:'user',startup_source:'cli',model:'gpt-6-astra',
            model_provider:'openai',project:'office',created_ms:100000,updated_ms:200000,recent_ms:200000,
            agent_path:'/root/a',parent_id:'parent',child_count:2}]
    };
}
function fixture({desktop=false}={}) {
    let context;
    class Element {
        constructor(tag='div') { this.tag=tag; this.children=[]; this.listeners={}; this.dataset={}; this.attributes={}; this.textContent=''; this.value=''; this.className=''; this.scrollTop=0; this.open=false; this.hidden=false; }
        append(...items) { this.children.push(...items); }
        replaceChildren(...items) { this.children=[...items]; }
        addEventListener(name,listener) { this.listeners[name]=listener; }
        setAttribute(name,value) { this.attributes[name]=value; }
        contains(node) { return this===node || this.children.some(child=>child.contains(node)); }
        focus() { context.document.activeElement=this; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        querySelectorAll(selector) {
            const all=this.children.flatMap(walk);
            if(selector==='summary') return all.filter(node=>node.tag==='summary');
            if(selector==='span') return all.filter(node=>node.tag==='span');
            if(selector==='[data-archive-text]') return all.filter(node=>node.dataset.archiveText);
            return [];
        }
        get lastElementChild() { return this.children.at(-1); }
        showPopover() { this.listeners.toggle?.({newState:'open'}); }
        set innerHTML(_) { throw new Error('Metadata must not be parsed as HTML'); }
    }
    const walk=node=>[node,...node.children.flatMap(walk)];
    const html=fs.readFileSync('frontend/index.html','utf8');
    const block=html.slice(html.indexOf('<section id="thread-archive-panel"'),html.indexOf('<section id="agent-board-panel"'));
    const nodes=new Map();
    for(const match of block.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const node=new Element(match[1]);node.id=match[3]; nodes.set(node.id,node);
        const label=match[2].match(/data-archive-text="([^"]+)"/);
        if(label) node.dataset.archiveText=label[1];
    }
    const panel=nodes.get('thread-archive-panel'); panel.append(...[...nodes.values()].filter(node=>node!==panel));
    const invoker=new Element('button');invoker.id='office-archive-button';invoker.append(new Element('span'));nodes.set(invoker.id,invoker);
    let result=sample(), fail=false, deferred=null;
    const requests=[], timers=[], invocations=[];
    context={
        window:{location:{hash:''},...(desktop?{__TAURI__:{core:{invoke:async(...args)=>invocations.push(args)}}}:{})},
        document:{hidden:false,activeElement:null,getElementById:id=>nodes.get(id)||[...nodes.values()].flatMap(walk).find(node=>node.id===id),
            createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element();node.textContent=text;return node;},
            querySelector:()=>null,addEventListener(){}},
        localStorage:{getItem:()=>null},AbortController,URLSearchParams,URL,
        setInterval:callback=>{timers.push(callback);return timers.length;},
        fetch:async(url,options)=>{
            requests.push({url,options});
            if(deferred) return deferred;
            if(fail) throw new Error('offline');
            return {ok:true,status:200,json:async()=>structuredClone(result)};
        }
    };
    vm.runInNewContext(fs.readFileSync('frontend/thread-archive.js','utf8'),context);
    const settle=()=>new Promise(setImmediate);
    const text=node=>[node.textContent,...node.children.map(text)].join(' ');
    return {nodes,context,requests,invocations,
        set:value=>{result=value;},fail:value=>{fail=value;},defer:promise=>{deferred=promise;},
        async open(){panel.showPopover();await settle();},
        async close(){panel.listeners.toggle({newState:'closed'});await settle();},
        async poll(){timers[0]();await settle();},
        async event(id,name='click',event={preventDefault(){}}){await nodes.get(id).listeners[name](event);await settle();},
        translate:lang=>context.window.ThreadArchive.translate(lang),
        text:id=>text(nodes.get(id)),walk,settle};
}

test('archive only reads when open and visible, aborting closed requests',async()=>{
    const f=fixture(); await f.poll(); assert.equal(f.requests.length,0);
    await f.open(); assert.equal(f.requests.length,1);
    await f.poll(); assert.equal(f.requests.length,2);
    f.context.document.hidden=true; await f.poll(); assert.equal(f.requests.length,2);
    await f.close(); f.context.document.hidden=false; await f.poll(); assert.equal(f.requests.length,2);
    assert.equal(f.requests[0].options.cache,'no-store');
});
test('shows exact token values and sources, and treats stored text as literal DOM text',async()=>{
    const f=fixture();await f.open();
    const text=f.text('archive-list');
    assert.ok(text.includes('4,777,736,001'));
    assert.ok(text.includes('thread_source')&&text.includes('user'));
    assert.ok(text.includes('source')&&text.includes('cli'));
    assert.ok(text.includes('<script>alert(1)</script>'));
    assert.ok(text.includes('<img src=x>'));
    assert.ok(text.includes('/root/a'));
    assert.ok(f.text('archive-summary').includes('4,777,736,001'));
});
test('filters and search reset pagination with encoded query parameters',async()=>{
    const f=fixture();await f.open();await f.event('archive-next');
    assert.equal(new URL(f.requests.at(-1).url,'http://localhost').searchParams.get('offset'),'20');
    f.nodes.get('archive-source').value='future_feature';
    await f.event('archive-source','change',{target:f.nodes.get('archive-source')});
    let params=new URL(f.requests.at(-1).url,'http://localhost').searchParams;
    assert.equal(params.get('source'),'future_feature');assert.equal(params.get('offset'),'0');
    f.nodes.get('archive-query').value='A & B';
    await f.event('archive-search','submit');
    params=new URL(f.requests.at(-1).url,'http://localhost').searchParams;
    assert.equal(params.get('query'),'A & B');
});
test('parent navigation resets source and model filters',async()=>{
    const f=fixture();await f.open();
    const button=f.walk(f.nodes.get('archive-list')).find(n=>n.className==='archive-parent');
    await button.listeners.click();await f.settle();
    const params=new URL(f.requests.at(-1).url,'http://localhost').searchParams;
    assert.equal(params.get('query'),'parent');assert.equal(params.get('source'),'');assert.equal(params.get('offset'),'0');
});
test('unchanged polling preserves row elements, expansion and scroll',async()=>{
    const f=fixture();await f.open();
    const list=f.nodes.get('archive-list'),card=list.children[0];
    card.open=true;card.listeners.toggle();list.scrollTop=90;
    await f.poll();assert.equal(list.children[0],card);assert.equal(list.scrollTop,90);
    const next=sample();next.threads[0].tokens_used=55;f.set(next);await f.poll();
    assert.notEqual(list.children[0],card);assert.equal(list.children[0].open,true);assert.equal(list.scrollTop,90);
});
test('missing and failed databases have retryable states',async()=>{
    const f=fixture();f.set({ok:true,available:false,threads:[],summary:{},facets:{},pagination:{offset:0,limit:20,total:0}});
    await f.open();assert.ok(f.text('archive-status').includes('暂无'));
    f.fail(true);await f.event('archive-refresh');assert.ok(f.text('archive-status').includes('重试'));
    f.fail(false);f.set(sample());await f.event('archive-refresh');assert.equal(f.nodes.get('archive-status').hidden,true);
});
test('stale responses never replace current filters',async()=>{
    const f=fixture();let resolve;
    f.defer(new Promise(r=>{resolve=r;}));await f.open();
    f.defer(null);await f.event('archive-refresh');
    const old=sample();old.threads[0].title='过期结果';resolve({ok:true,json:async()=>old});await f.settle();
    assert.ok(!f.text('archive-list').includes('过期结果'));
});
test('desktop opens expand the window and translations include unknown source types',async()=>{
    const f=fixture({desktop:true});await f.open();assert.equal(f.invocations[0][1].expanded,true);
    f.translate('en');assert.ok(f.text('office-archive-button').includes('Codex sessions'));
    assert.ok(f.text('archive-source').includes('future_feature'));
    await f.close();assert.equal(f.invocations.at(-1)[1].expanded,false);
});

test('unknown thread_source strings are preserved even when matching a translation key',async()=>{
    const f=fixture(), data=sample();data.threads[0].thread_source='title';f.set(data);await f.open();
    const badge=f.walk(f.nodes.get('archive-list')).find(n=>n.className==='archive-source');
    assert.equal(badge.textContent,'title');
});
test('an out-of-range page returns to the last available page',async()=>{
    const f=fixture();await f.open();
    const data=sample();data.pagination={offset:20,limit:20,total:1};data.filtered_summary.threads=1;
    // First response has a stale offset, second reflects the redirected request.
    const original=f.context.fetch;let first=true;
    f.context.fetch=async(...args)=>{
        if(first){first=false;return {ok:true,json:async()=>data};}
        f.set(sample());return original(...args);
    };
    await f.event('archive-refresh');
    assert.equal(new URL(f.requests.at(-1).url,'http://localhost').searchParams.get('offset'),'0');
});
