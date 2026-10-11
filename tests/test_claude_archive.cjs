const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function sample() {
    const usage={input_tokens:100,output_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:5};
    const summary={sessions:1,subagents:20,tokens:155,tool_calls:2,usage,replies:3,usage_replies:2,
        models:[{value:'model-a',count:3,tokens:155}],tools:[{value:'Read',count:2}]};
    return {ok:true,available:true,summary,filtered_summary:summary,coverage:{skipped_lines:0,unreadable_files:0,unidentified_usage:0},
        facets:{kinds:[{value:'main',count:1},{value:'subagent',count:20}],models:[{value:'model-a',count:21}],projects:[{value:'office',count:21}]},
        pagination:{offset:0,limit:20,total:21},sessions:[{id:'s1',kind:'main',title:'<script>stored text</script>',preview:'<img src=x>',
            project:'office',parent_id:'',agent:'',created_ms:1000,updated_ms:2000,branch:'main',version:'1',prompts:1,replies:2,usage_replies:2,
            models:['model-a'],usage,tokens:155,tool_calls:2}]};
}
function fixture(desktop=false) {
    let context;
    class Element {
        constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.attributes={};this.textContent='';this.value='';this.className='';this.scrollTop=0;this.open=false;}
        append(...items){this.children.push(...items);}
        replaceChildren(...items){this.children=items;}
        addEventListener(name,callback){this.listeners[name]=callback;}
        setAttribute(name,value){this.attributes[name]=value;}
        contains(el){return this===el || this.children.some(child=>child.contains(el));}
        querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
        querySelectorAll(selector){const all=this.children.flatMap(walk);return all.filter(el=>selector==='span' ? el.tag==='span' : selector==='summary' ? el.tag==='summary' : el.dataset.claudeArchiveText);}
        focus(){context.document.activeElement=this;}
        showPopover(){this.listeners.toggle({newState:'open'});}
        set innerHTML(_){throw new Error('Native data must remain literal DOM text');}
    }
    const walk=node=>[node,...node.children.flatMap(walk)], nodes=new Map();
    const html=fs.readFileSync('frontend/'+(desktop?'electron-standalone.html':'index.html'),'utf8');
    const block=html.slice(html.indexOf('<section id="claude-archive-panel"'),html.indexOf('<section id="thread-archive-panel"'));
    for(const match of block.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const el=new Element(match[1]);el.id=match[3];nodes.set(el.id,el);
        const label=match[2].match(/data-claude-archive-text="([^"]+)"/);if(label)el.dataset.claudeArchiveText=label[1];
    }
    const panel=nodes.get('claude-archive-panel');panel.append(...[...nodes.values()].filter(el=>el!==panel));
    const button=new Element('button');button.append(new Element('span'));nodes.set('office-claude-archive-button',button);
    if (!desktop && html.includes('data-claude-archive-menu="true"')) button.dataset.claudeArchiveMenu='true';
    let result=sample(),failed=false,deferred=null;
    const requests=[],invocations=[];
    context={window:{location:{hash:''},...(desktop?{__TAURI__:{core:{invoke:async(...args)=>invocations.push(args)}}}:{})},
        document:{activeElement:null,getElementById:id=>nodes.get(id),querySelector:()=>null,createElement:tag=>new Element(tag)},
        localStorage:{getItem:()=>null},URLSearchParams,AbortController,
        setInterval:()=>{throw new Error('This archive must not poll');},setTimeout:()=>{throw new Error('This archive must not schedule scans');},
        fetch:async(url,options)=>{requests.push({url,options});if(deferred)return deferred;if(failed)throw new Error('offline');return {ok:true,json:async()=>structuredClone(result)};}};
    vm.runInNewContext(fs.readFileSync('frontend/claude-archive.js','utf8'),context);
    const settle=()=>new Promise(setImmediate), text=el=>[el.textContent,...el.children.map(text)].join(' ');
    return {nodes,context,requests,invocations,set:value=>{result=value;},fail:value=>{failed=value;},defer:value=>{deferred=value;},settle,
        async open(){panel.showPopover();await settle();},async close(){panel.listeners.toggle({newState:'closed'});await settle();},
        async event(id,name='click'){const target=nodes.get('claude-archive-'+id);await target.listeners[name]({target,preventDefault(){}});await settle();},
        text:id=>text(nodes.get('claude-archive-'+id)),translate:lang=>context.window.ClaudeArchive.translate(lang)};
}

test('no background requests; open and refresh read, close aborts pending reads',async()=>{
    const f=fixture();assert.equal(f.requests.length,0);await f.event('refresh');assert.equal(f.requests.length,0);
    await f.open();assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.cache,'no-store');
    await f.event('refresh');assert.equal(f.requests.length,2);await f.close();assert.equal(f.requests.length,2);
    let resolve;f.defer(new Promise(r=>{resolve=r;}));await f.open();await f.close();
    assert.ok(f.requests.at(-1).options.signal.aborted);const stale=sample();stale.sessions[0].title='STALE';resolve({ok:true,json:async()=>stale});await f.settle();
    assert.ok(!f.text('list').includes('STALE'));
});
test('shows usage breakdown, coverage, top tools and stored text safely',async()=>{
    const f=fixture(),data=sample();data.sessions[0].preview += '\n' + '评审正文。'.repeat(200) + '\n最后一段完整显示';
    f.set(data);await f.open();assert.ok(f.text('summary').includes('155'));assert.ok(f.text('usage').includes('缓存读取'));
    assert.ok(f.text('coverage').includes('2 / 3'));assert.ok(f.text('rank-list').includes('Read × 2'));
    assert.ok(f.text('list').includes('<script>stored text</script>'));assert.ok(f.text('list').includes('<img src=x>'));
    assert.ok(f.text('list').includes(data.sessions[0].preview));
});
test('menu labels are short and the panel keeps its complete provider name',async()=>{
    const f=fixture();assert.equal(f.nodes.get('office-claude-archive-button').querySelector('span').textContent,'Claude 会话档案');
    f.translate('en');assert.equal(f.nodes.get('office-claude-archive-button').querySelector('span').textContent,'Claude sessions');
    assert.equal(f.text('title'),'Claude Code sessions');
});
test('pagination and filters encode parameters and reset offsets',async()=>{
    const f=fixture();await f.open();await f.event('next');assert.equal(new URL(f.requests.at(-1).url,'http://local').searchParams.get('offset'),'20');
    f.nodes.get('claude-archive-project').value='A & B';await f.event('project','change');
    const p=new URL(f.requests.at(-1).url,'http://local').searchParams;assert.equal(p.get('project'),'A & B');assert.equal(p.get('offset'),'0');
    f.nodes.get('claude-archive-query').value='query';await f.event('search','submit');assert.equal(new URL(f.requests.at(-1).url,'http://local').searchParams.get('query'),'query');
});
test('missing and failed reads can recover, and unknown usage is not displayed as zero',async()=>{
    const f=fixture();const missing=sample();missing.available=false;f.set(missing);await f.open();assert.ok(f.text('status').includes('暂无'));
    f.fail(true);await f.event('refresh');assert.ok(f.text('status').includes('重试'));f.fail(false);
    const data=sample();data.sessions[0].usage_replies=0;f.set(data);await f.event('refresh');assert.ok(f.text('list').includes('未记录'));
});
test('desktop shares the panel; language changes and refresh preserve expanded rows',async()=>{
    const f=fixture(true);await f.open();assert.equal(f.invocations[0][1].expanded,true);
    const row=f.nodes.get('claude-archive-list').children[0];row.open=true;row.listeners.toggle();await f.event('refresh');
    assert.equal(f.nodes.get('claude-archive-list').children[0],row);
    f.translate('en');assert.ok(f.text('title').includes('Claude Code sessions'));assert.ok(f.nodes.get('claude-archive-list').children[0].open);
    await f.close();assert.equal(f.invocations.at(-1)[1].expanded,false);
});
