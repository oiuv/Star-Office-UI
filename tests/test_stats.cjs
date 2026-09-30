const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const NOW = 1790769024;
const stateNames = ['idle','writing','researching','executing','syncing','error'];
const hookNames = ['PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','SessionStart','SessionEnd','UserPromptSubmit','SubagentStart','SubagentStop','Stop','Interrupt'];
function actor(actor_id, source, online, extra = {}) {
  return {actor_id,source,online,actor_name:source === 'codex' ? 'Codex session-a' : 'Star',
    state:online ? 'executing' : 'idle',updated_at:NOW-(online ? 5 : 3508),is_subagent:0,...extra};
}
async function fixture(actors, office, {lang='zh',statusFails=false,achievements=[]} = {}) {
  function node(tag='div') {
    return {tag,children:[],style:{},dataset:{},attributes:{},listeners:{},value:'',textContent:'',hidden:false,
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; },
      add(item) { this.children.push(item); },
      addEventListener(name,handler) { this.listeners[name]=handler; },
      setAttribute(name,value) { this.attributes[name]=value; }
    };
  }
  const markup = fs.readFileSync('frontend/stats.html','utf8');
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map([...ids].map(id => [id,node()]));
  nodes.get('presence-note').dataset.i18n='presenceNote';
  const history = [{occurred_at:NOW-3508,event_name:'StateUpdate',actor_name:'Star',state:'idle',
    source:'api',detail:'Manual update',applied:true,heartbeat:false}];
  const stats = {
    ok:true,since:NOW-86400,until:NOW,
    overview:{events:2,heartbeats:0,turns:0,sessions:1,tools:0,tool_errors:0,active_seconds:0,
      transitions:1,permission_requests:0,interrupts:0,compactions:0,subagents:0,state_updates:1,
      measured_tools:0,average_tool_seconds:null},
    game:{xp:0,period_xp:0,level:1,level_xp:0,badges:achievements},
    states:Object.fromEntries(stateNames.map(state => [state,{count:0,seconds:0}])),
    hooks:Object.fromEntries(hookNames.map(hook => [hook,0])),daily:[],actors
  };
  const requests=[];
  const achievementButtons = ['all','locked','earned'].map(value => {
    const button=node('button'); button.dataset.achievementFilter=value; return button;
  });
  const languageButtons = ['zh','en','ja'].map(value => {
    const button=node('button'); button.dataset.lang=value; return button;
  });
  const context={
    document:{hidden:false,documentElement:{},getElementById:id=>nodes.get(id)||null,
      createElement:node,querySelectorAll:selector=>({
        '[data-i18n]':[nodes.get('presence-note')],
        '[data-achievement-filter]':achievementButtons,
        '[data-lang]':languageButtons
      }[selector] || []),addEventListener(){}},
    localStorage:{getItem:()=>lang,setItem(){}},
    Option:function(text,value) { this.textContent=text; this.value=value; },
    AbortController,URLSearchParams,URL,Blob,setInterval(){},setTimeout(){},
    fetch:async url=>{
      requests.push(url);
      if(url==='/status') return {ok:!statusFails,status:statusFails?503:200,json:async()=>office};
      if(url.startsWith('/api/stats')) return {ok:true,json:async()=>stats};
      if(url.startsWith('/api/events')) return {ok:true,json:async()=>({ok:true,events:history})};
      throw new Error('Unexpected request: '+url);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('frontend/stats.js','utf8'),context);
  await new Promise(setImmediate);
  return {nodes,requests,stats,badges:nodes.get('actors').children,
    filter:value=>achievementButtons.find(b=>b.dataset.achievementFilter===value).listeners.click(),
    language:value=>languageButtons.find(b=>b.dataset.lang===value).listeners.click()};
}

test('Codex and old manual updates display as one current Star character',async()=>{
  const codex=actor('codex-a','codex',true);
  const f=await fixture([codex,actor('main','api',false)],{actor_id:'codex-a'});
  assert.equal(f.badges.length,1);
  assert.equal(f.badges[0].textContent,'Star · Codex hooks · 在线');
  assert.equal(f.badges[0].className,'actor online');
  assert.ok(f.badges[0].title.includes('Codex session-a'));
  assert.ok(f.requests.includes('/status'));
  assert.equal(f.stats.actors.length,2);
  const body=f.nodes.get('event-list').children[0].children[2];
  assert.ok(body.children[0].textContent.startsWith('Star ·'));
});

test('A manual override remains the main character while other sessions remain visible',async()=>{
  const f=await fixture([actor('codex-a','codex',true),actor('main','api',true)],{});
  assert.deepEqual(f.badges.map(badge=>badge.textContent),['Star · 主动调用 · 在线','Codex session-a · 在线']);
});

test('The office-selected busy session takes priority over a newer idle session',async()=>{
  const f=await fixture([
    actor('codex-idle','codex',true,{actor_name:'Codex session-b',state:'idle',updated_at:NOW}),
    actor('codex-busy','codex',true),actor('main','cli',false)
  ],{actor_id:'codex-busy'});
  assert.equal(f.badges[0].textContent,'Star · Codex hooks · 在线');
  assert.ok(f.badges[0].title.includes('Codex session-a'));
  assert.equal(f.badges[1].textContent,'Codex session-b · 在线');
});

test('Subagents stay independent from the main character',async()=>{
  const f=await fixture([
    actor('codex-a','codex',true),actor('main','api',false),
    actor('child','codex',true,{actor_name:'Agent child',is_subagent:1})
  ],{actor_id:'codex-a'});
  assert.deepEqual(f.badges.map(badge=>badge.textContent),['Star · Codex hooks · 在线','Agent child · 在线']);
});

test('Expired or ended Codex sessions do not make Star appear online',async()=>{
  const f=await fixture([actor('codex-a','codex',false,{ended:1}),actor('main','api',false)],{actor_id:'codex-a'});
  assert.equal(f.badges.length,1);
  assert.equal(f.badges[0].textContent,'Star · Codex hooks · 离线');
  assert.equal(f.badges[0].className,'actor');
});

test('Presence labels support English and Japanese',async()=>{
  for(const [lang,label] of [['en','Star · Codex hooks · online'],['ja','Star · Codex hooks · オンライン']]) {
    const f=await fixture([actor('codex-a','codex',true)],{actor_id:'codex-a'},{lang});
    assert.equal(f.badges[0].textContent,label);
    assert.ok(f.nodes.get('presence-note').textContent.includes('Star'));
  }
});

test('A failed office status request reports an error instead of guessing the main character',async()=>{
  const f=await fixture([actor('codex-a','codex',true)],{}, {statusFails:true});
  assert.equal(f.nodes.get('error').hidden,false);
  assert.equal(f.nodes.get('error').textContent,'读取失败，稍后自动重试。');
  assert.equal(f.badges.length,0);
});

const achievementFixtures = [
  {id:'first_turn',category:'turns',hook:'Stop',target:1,current:6,earned:true},
  {id:'tool_100',category:'tools',hook:'PostToolUse',target:100,current:42,earned:false},
  {id:'teamwork',category:'team',hook:'SubagentStop',target:1,current:0,earned:false}
];
function achievementCards(f) {
  return f.nodes.get('badges').children.flatMap(group => group.children[1]?.children || []);
}
test('Achievements show conditions, bounded progress, and the lifetime unlocked count',async()=>{
  const f=await fixture([],{}, {achievements:achievementFixtures});
  const cards=achievementCards(f);
  assert.equal(f.nodes.get('achievement-count').textContent,'1 / 3 已解锁');
  assert.equal(cards.length,3);
  assert.equal(cards[0].children[0].children[1].textContent,'初次收工');
  assert.equal(cards[0].children[2].value,1);
  assert.equal(cards[0].children[3].textContent,'1 / 1');
  assert.equal(cards[1].children[1].textContent,'成功执行 100 次工具');
  assert.equal(cards[1].children[2].value,42);
  assert.equal(cards[1].children[2].max,100);
  assert.equal(cards[1].children[2].attributes['aria-label'],'工具熟练者 · 解锁进度');
});
test('Achievement filtering survives language changes without expanding a closed cabinet',async()=>{
  const f=await fixture([],{}, {achievements:achievementFixtures});
  f.nodes.get('achievements').open=false;
  f.filter('locked');
  assert.deepEqual(achievementCards(f).map(card=>card.dataset.badgeId),['tool_100','teamwork']);
  f.language('en');
  assert.equal(achievementCards(f).length,2);
  assert.equal(achievementCards(f)[0].children[1].textContent,'Complete 100 successful tool calls');
  assert.equal(f.nodes.get('achievements').open,false);
  f.filter('earned');
  assert.deepEqual(achievementCards(f).map(card=>card.dataset.badgeId),['first_turn']);
  f.filter('all');
  assert.equal(achievementCards(f).length,3);
});
test('Achievement filters explain empty results',async()=>{
  const f=await fixture([],{}, {achievements:achievementFixtures.filter(b=>b.earned)});
  f.filter('locked');
  assert.equal(f.nodes.get('badges').children[0].textContent,'全部成就已解锁。');
  const empty=await fixture([],{}, {achievements:achievementFixtures.filter(b=>!b.earned)});
  empty.filter('earned');
  assert.equal(empty.nodes.get('badges').children[0].textContent,'还没有解锁的成就。收到对应活动后会自动点亮。');
});
test('Japanese achievement names and rules are translated',async()=>{
  const f=await fixture([],{}, {lang:'ja',achievements:achievementFixtures});
  const card=achievementCards(f)[1];
  assert.equal(card.children[0].children[1].textContent,'ツール名人');
  assert.equal(card.children[1].textContent,'ツールを 100 回正常に実行');
});
