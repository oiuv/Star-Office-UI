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
async function fixture(actors, office, {lang='zh',statusFails=false,achievements=[],storage=new Map(),storageFails=false,gameExtra={},hookCounts={}} = {}) {
  function node(tag='div') {
    return {tag,children:[],style:{},dataset:{},attributes:{},listeners:{},value:'',textContent:'',hidden:false,
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; },
      add(item) { this.children.push(item); },
      addEventListener(name,handler) { this.listeners[name]=handler; },
      setAttribute(name,value) { this.attributes[name]=value; },
      focus() { context.document.activeElement=this; }
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
    game:{xp:0,period_xp:0,level:1,level_xp:0,badges:achievements,...gameExtra},
    states:Object.fromEntries(stateNames.map(state => [state,{count:0,seconds:0}])),
    hooks:{...Object.fromEntries(hookNames.map(hook => [hook,0])),...hookCounts},daily:[],actors
  };
  const requests=[], intervals=[];
  if (!storage.has('uiLang')) storage.set('uiLang',lang);
  const achievementButtons = ['all','repeatable','locked','earned'].map(value => {
    const button=node('button'); button.dataset.achievementFilter=value; return button;
  });
  const languageButtons = ['zh','en','ja'].map(value => {
    const button=node('button'); button.dataset.lang=value; return button;
  });
  const periodButtons = ['today','7d','30d','all'].map(value => { const button=node('button'); button.dataset.period=value; return button; });
  const hookViewButtons = ['lifecycle','categories'].map(value => { const button=node('button'); button.dataset.hookView=value; return button; });
  const descendants = item => [item,...(item.children || []).flatMap(descendants)];
  const context={
    document:{hidden:false,documentElement:{},getElementById:id=>nodes.get(id)||[...nodes.values()].flatMap(descendants).find(item=>item.id===id)||null,
      createElement:node,querySelectorAll:selector=>({
        '[data-i18n]':[nodes.get('presence-note')],
        '[data-achievement-filter]':achievementButtons,
        '[data-lang]':languageButtons,
        '[data-period]':periodButtons,
        '[data-hook-view]':hookViewButtons
      }[selector] || []),addEventListener(){}},
    localStorage:{getItem:key=>{ if(storageFails) throw new Error('blocked'); return storage.get(key)||null; },setItem(key,value){ if(storageFails) throw new Error('blocked'); storage.set(key,value); }},
    Option:function(text,value) { this.textContent=text; this.value=value; },
    AbortController,URLSearchParams,URL,Blob,setInterval(callback){ intervals.push(callback); },setTimeout(){},
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
  return {nodes,requests,stats,storage,context,hookViewButtons,
    async poll() { intervals[0](); await new Promise(setImmediate); },
    async period(value) { periodButtons.find(b=>b.dataset.period===value).listeners.click(); await new Promise(setImmediate); },
    async hookView(value) {
      const button=hookViewButtons.find(b=>b.dataset.hookView===value);
      button.focus(); button.listeners.click(); await new Promise(setImmediate);
    },
    badges:nodes.get('actors').children,
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
  {id:'first_tool_success',category:'tools',hook:'PostToolUse',target:1,current:0,earned:false},
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
  assert.equal(cards[1].children[1].textContent,'基础 · 成功执行 1 次工具');
  assert.equal(cards[1].children[2].value,0);
  assert.equal(cards[1].children[2].max,1);
  assert.equal(cards[1].children[2].attributes['aria-label'],'初试成功 · 解锁进度');
});
test('Achievement filtering survives language changes without expanding a closed cabinet',async()=>{
  const f=await fixture([],{}, {achievements:achievementFixtures});
  f.nodes.get('achievements').open=false;
  f.filter('locked');
  assert.deepEqual(achievementCards(f).map(card=>card.dataset.badgeId),['first_tool_success','teamwork']);
  f.language('en');
  assert.equal(achievementCards(f).length,2);
  assert.equal(achievementCards(f)[0].children[1].textContent,'Basic · Complete 1 successful tool calls');
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
  assert.equal(card.children[0].children[1].textContent,'初めての成功');
  assert.equal(card.children[1].textContent,'基本 · ツールを 1 回正常に実行');
});

const GOALS_KEY = 'starOffice.achievementGoals';
function growingBadge(id='tool_1000', overrides={}) {
  return {id,category:'tools',hook:'PostToolUse',target:1000,current:2338,earned:true,
    repeatable:true,level:2,level_progress:338,level_target:2000,next_target:4000,remaining:1662,tier:2,...overrides};
}
function descendants(item) { return [item,...(item.children || []).flatMap(descendants)]; }
function byClass(item, name) { return descendants(item).find(node=>(node.className||'').split(' ').includes(name)); }
function pin(f,id,placement='cabinet') {
  const card=placement==='goal' ? f.nodes.get('achievement-goals').children.find(card=>card.dataset.badgeId===id)
    : achievementCards(f).find(card=>card.dataset.badgeId===id);
  const button=byClass(card,'achievement-pin');
  if(!button.disabled) button.listeners.click();
  return button;
}
const growingFixtures = [growingBadge(),
  growingBadge('session_50',{category:'sessions',hook:'SessionStart'}),
  growingBadge('turn_100',{category:'turns',hook:'Stop'}),
  growingBadge('compact_50',{category:'context',hook:'PostCompact',target:50,level_target:50,current:45,earned:false,level:0,level_progress:45,next_target:50,remaining:5,tier:0})];

test('Growing badges show true totals, next-level progress and retain unlock count',async()=>{
  const f=await fixture([],{}, {achievements:[...achievementFixtures,growingBadge()]});
  const card=achievementCards(f).find(card=>card.dataset.badgeId==='tool_1000');
  assert.equal(f.nodes.get('achievement-count').textContent,'2 / 4 已解锁');
  assert.equal(byClass(card,'achievement-level').textContent,'Lv.2');
  assert.equal(byClass(card,'achievement-total').textContent,'累计：成功执行 2,338 次工具');
  assert.equal(byClass(card,'achievement-progress').value,338);
  assert.equal(byClass(card,'achievement-progress').max,2000);
  assert.equal(byClass(card,'growing-progress').children[0].textContent,'升至 Lv.3');
  assert.equal(byClass(card,'achievement-remaining').textContent,'还需 1,662 次');
  assert.equal(card.dataset.tier,'2');
  f.filter('repeatable');
  assert.deepEqual(achievementCards(f).map(card=>card.dataset.badgeId),['tool_1000']);
});

test('Exact level boundaries start the next progress bar without locking the badge again',async()=>{
  const f=await fixture([],{}, {achievements:[growingBadge('tool_1000',{current:4000,level:3,level_progress:0,level_target:4000,next_target:8000,remaining:4000,tier:3})]});
  f.filter('earned');
  const card=achievementCards(f)[0];
  assert.equal(card.dataset.tier,'3');
  assert.equal(byClass(card,'achievement-progress').value,0);
  assert.equal(byClass(card,'achievement-level').textContent,'Lv.3');
  assert.equal(byClass(card,'achievement-tier').textContent,'银星');
});

test('At most three followed goals persist across reloads, filters, periods, language and polling',async()=>{
  const storage=new Map();
  const f=await fixture([],{}, {achievements:growingFixtures,storage});
  for(const badge of growingFixtures.slice(0,3)) pin(f,badge.id);
  assert.equal(f.nodes.get('achievement-goals').children.length,3);
  assert.equal(pin(f,'compact_50').disabled,true);
  assert.deepEqual(JSON.parse(storage.get(GOALS_KEY)),growingFixtures.slice(0,3).map(b=>b.id));
  f.filter('locked');
  f.language('en');
  await f.period('7d');
  await f.poll();
  assert.equal(f.nodes.get('achievement-goals').children.length,3);
  assert.equal(f.nodes.get('achievement-goals-count').textContent,'3 / 3 followed');
  const reloaded=await fixture([],{}, {achievements:growingFixtures,storage});
  assert.equal(reloaded.nodes.get('achievement-goals').children.length,3);
  pin(reloaded,'tool_1000','goal');
  assert.equal(reloaded.nodes.get('achievement-goals').children.length,2);
  pin(reloaded,'compact_50');
  const lockedGoal=reloaded.nodes.get('achievement-goals').children[2];
  assert.equal(lockedGoal.dataset.badgeId,'compact_50');
  assert.equal(byClass(lockedGoal,'achievement-progress').value,45);
  assert.equal(reloaded.nodes.get('achievement-goals-empty').hidden,true);
});

test('Malformed, obsolete, duplicated and oversized saved goal lists are handled',async()=>{
  for(const raw of ['oops','{}','null','[42,null]',JSON.stringify(['unknown','first_turn','tool_1000','tool_1000','session_50','turn_100','compact_50'])]) {
    const f=await fixture([],{}, {achievements:[...achievementFixtures,...growingFixtures],storage:new Map([[GOALS_KEY,raw]])});
    const ids=f.nodes.get('achievement-goals').children.map(card=>card.dataset.badgeId);
    assert.ok(ids.length<=3);
    assert.equal(ids.length,new Set(ids).size);
    assert.ok(ids.every(id=>growingFixtures.some(b=>b.id===id)));
    assert.equal(f.nodes.get('error').hidden,true);
  }
});

test('Following still works for this visit when browser storage is unavailable',async()=>{
  const f=await fixture([],{}, {achievements:growingFixtures,storageFails:true});
  pin(f,'tool_1000');
  await f.poll();
  assert.equal(f.nodes.get('achievement-goals').children.length,1);
  assert.equal(f.nodes.get('error').hidden,true);
});

test('Followed goals update live and keyboard focus survives polling',async()=>{
  const badge=growingBadge();
  const f=await fixture([],{}, {achievements:[badge]});
  pin(f,badge.id);
  assert.equal(f.context.document.activeElement.id,'achievement-pin-cabinet-tool_1000');
  Object.assign(badge,{current:4001,level:3,level_progress:1,level_target:4000,next_target:8000,remaining:3999});
  await f.poll();
  assert.equal(byClass(f.nodes.get('achievement-goals').children[0],'achievement-level').textContent,'Lv.3');
  assert.equal(f.context.document.activeElement.id,'achievement-pin-cabinet-tool_1000');
});

test('Growing badge controls and milestones translate into English and Japanese',async()=>{
  const f=await fixture([],{}, {achievements:[growingBadge('tool_1000',{tier:10,level:12})]});
  for(const [language,remaining,tier] of [['en','1,662 more to go','Legendary'],['ja','あと 1,662 回','伝説']]) {
    f.language(language);
    const card=achievementCards(f)[0];
    assert.equal(byClass(card,'achievement-level').textContent,'Lv.12');
    assert.equal(byClass(card,'achievement-remaining').textContent,remaining);
    assert.equal(byClass(card,'achievement-tier').textContent,tier);
  }
});

test('Choose goals opens the cabinet and shows only growing badges',async()=>{
  const f=await fixture([],{}, {achievements:[...achievementFixtures,...growingFixtures]});
  f.nodes.get('achievements').open=false;
  f.nodes.get('achievement-goals-link').listeners.click();
  assert.equal(f.nodes.get('achievements').open,true);
  assert.equal(achievementCards(f).length,4);
  assert.equal(f.nodes.get('achievement-goals-empty').hidden,false);
});

test('Legacy followed milestones migrate within the same activity to its advanced badge',async()=>{
  const advanced=[
    growingBadge('prompt_100',{category:'prompts',hook:'UserPromptSubmit',target:100}),
    growingBadge('tool_started_1000',{category:'tool_attempts',hook:'PreToolUse'}),
    growingBadge('delegate_10',{category:'delegation',hook:'SubagentStart',target:10})
  ];
  const storage=new Map([[GOALS_KEY,JSON.stringify(['prompt_25','prompt_100','tool_started_100','delegate_10'])]]);
  const f=await fixture([],{}, {achievements:advanced,storage});
  assert.deepEqual(f.nodes.get('achievement-goals').children.map(card=>card.dataset.badgeId),['prompt_100','tool_started_1000','delegate_10']);
  pin(f,'delegate_10','goal');
  assert.deepEqual(JSON.parse(storage.get(GOALS_KEY)),['prompt_100','tool_started_1000']);
});

test('A complete track groups two fixed milestones and one advanced card; filters never leave spanning holes',async()=>{
  const basic={id:'first_tool_success',category:'tools',hook:'PostToolUse',target:1,current:40,earned:true,kind:'basic'};
  const milestone={...basic,id:'tool_100',target:100,earned:false,kind:'milestone'};
  const advanced=growingBadge('tool_1000',{current:40,earned:false,level:0,level_progress:40,level_target:1000,next_target:1000,remaining:960,tier:0});
  const f=await fixture([],{}, {achievements:[basic,milestone,advanced]});
  const grid=()=>f.nodes.get('badges').children[0].children[1];
  assert.ok(grid().className.includes('achievement-track'));
  assert.deepEqual(achievementCards(f).map(card=>card.dataset.kind),['basic','milestone','advanced']);
  assert.equal(descendants(grid()).filter(n=>n.className==='achievement-pin').length,1);
  assert.ok(content(achievementCards(f)[1]).includes('里程碑 · 成功执行 100 次工具'));
  f.filter('locked');
  assert.equal(achievementCards(f).length,2);
  assert.ok(!grid().className.includes('achievement-track'));
  f.filter('repeatable');
  assert.equal(achievementCards(f).length,1);
  assert.ok(grid().className.includes('achievement-single'));
  f.filter('all');
  f.language('en');
  assert.ok(content(achievementCards(f)[1]).includes('Milestone'));
  f.language('ja');
  assert.ok(content(achievementCards(f)[1]).includes('節目'));
});

const lockedExploration = () => Array.from({length:10},(_,i)=>({slot:'exploration_'+String(i+1).padStart(2,'0'),earned:false}));
test('Locked discoveries reveal no names, conditions, identifiers, tooltips or progress',async()=>{
  const exploration=lockedExploration();
  // Even a response carrying a name must not reveal it before earned=true.
  exploration[0].id='night_owl';
  const f=await fixture([],{}, {gameExtra:{exploration}});
  assert.equal(f.nodes.get('exploration-section').hidden,false);
  const cards=f.nodes.get('exploration-badges').children;
  assert.equal(cards.length,10);
  for(const card of cards) {
    assert.equal(card.children.length,2);
    assert.equal(card.children[1].textContent,'待解锁成就');
    assert.deepEqual(card.dataset,{});
    assert.equal(card.title,undefined);
    assert.equal(descendants(card).filter(n=>n.tag==='progress').length,0);
    assert.ok(!content(card).includes('night_owl'));
    assert.ok(!content(card).includes('夜猫子'));
  }
  assert.equal(f.nodes.get('exploration-count').textContent,'0 / 10 已发现');
});
test('Discovery reveal, filters, translation and polling are independent of regular badges',async()=>{
  const exploration=lockedExploration();
  exploration[4]={slot:'exploration_05',id:'weekend_worker',earned:true};
  const f=await fixture([],{}, {achievements:achievementFixtures,gameExtra:{exploration}});
  assert.ok(content(f.nodes.get('exploration-badges')).includes('周末加班'));
  assert.ok(content(f.nodes.get('exploration-badges')).includes('周六或周日'));
  assert.equal(f.nodes.get('achievement-count').textContent,'1 / 3 已解锁');
  f.filter('repeatable');
  assert.equal(f.nodes.get('exploration-badges').children.length,10);
  assert.equal(f.nodes.get('exploration-count').textContent,'1 / 10 已发现');
  f.nodes.get('exploration-section').open=false;
  exploration[5]={slot:'exploration_06',id:'night_owl',earned:true};
  await f.poll();
  assert.ok(content(f.nodes.get('exploration-badges')).includes('夜猫子'));
  assert.equal(f.nodes.get('exploration-section').open,false);
  await f.period('7d');
  f.language('en');
  assert.ok(content(f.nodes.get('exploration-badges')).includes('Night owl'));
  assert.ok(content(f.nodes.get('exploration-badges')).includes('Undiscovered achievement'));
  f.language('ja');
  assert.ok(content(f.nodes.get('exploration-badges')).includes('夜ふかしさん'));
  assert.ok(content(f.nodes.get('exploration-badges')).includes('未発見の実績'));
});
test('The tenth discovery remains secret until the backend awards it',async()=>{
  const exploration=lockedExploration();
  const f=await fixture([],{}, {gameExtra:{exploration}});
  assert.ok(!content(f.nodes.get('exploration-badges')).includes('办公室探秘家'));
  exploration[9]={slot:'exploration_10',id:'exploration_master',earned:true};
  await f.poll();
  const last=f.nodes.get('exploration-badges').children[9];
  assert.ok(last.className.includes('exploration-completion'));
  assert.ok(content(last).includes('办公室探秘家'));
  assert.ok(content(last).includes('全部 9 段'));
});

const monthlyFixture = {
  current:{month:'2026-10',earned:false,days_left:27,goals:[
    {metric:'active_days',current:9,target:10},{metric:'prompts',current:134,target:100},{metric:'tools',current:2338,target:1000}
  ]},
  earned:[{month:'2026-09',earned:true,goals:[]}]
};
function content(node) { return descendants(node).map(item=>item.textContent||'').join(' '); }
test('Collection and monthly badge show independent progress and translate with date filters',async()=>{
  const f=await fixture([],{}, {gameExtra:{collection:{current:7,target:24,earned:false},monthly:monthlyFixture}});
  assert.equal(f.nodes.get('badge-collections').hidden,false);
  assert.ok(content(f.nodes.get('full-collection')).includes('全部 24 枚常规徽章'));
  assert.ok(content(f.nodes.get('full-collection')).includes('7 / 24'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('2026-10 · 收获时节'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('9 / 10'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('提交消息'));
  assert.ok(!content(f.nodes.get('monthly-challenge')).includes('结束回合'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('100 / 100 ✓'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('1,000 / 1,000 ✓'));
  assert.ok(content(f.nodes.get('monthly-archive')).includes('2026-09'));
  await f.period('7d');
  f.language('en');
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('Harvest time'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('Messages submitted'));
  assert.ok(content(f.nodes.get('full-collection')).includes('7 / 24'));
  f.language('ja');
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('実りの季節'));
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('メッセージ送信'));
  assert.ok(content(f.nodes.get('monthly-archive')).includes('秋の便り'));
});
test('Polling lights earned collections and starts a fresh month while retaining past badges',async()=>{
  const monthly=structuredClone(monthlyFixture);
  const collection={current:23,target:24,earned:false};
  const f=await fixture([],{}, {gameExtra:{monthly,collection}});
  collection.current=24; collection.earned=true;
  monthly.current.earned=true;
  monthly.current.goals[0].current=10;
  monthly.earned.unshift(structuredClone(monthly.current));
  await f.poll();
  assert.equal(f.nodes.get('full-collection').className,'collection-card earned');
  assert.equal(f.nodes.get('monthly-challenge').className,'monthly-card earned');
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('本月徽章已入藏'));
  monthly.current={month:'2026-11',earned:false,days_left:30,goals:monthly.current.goals.map(g=>({...g,current:0}))};
  await f.poll();
  assert.equal(f.nodes.get('monthly-challenge').className,'monthly-card');
  assert.ok(content(f.nodes.get('monthly-challenge')).includes('0 / 10'));
  assert.equal(f.nodes.get('monthly-archive').children.length,2);
});
test('Monthly empty collection explains how to start without an error',async()=>{
  const f=await fixture([],{}, {gameExtra:{collection:{current:0,target:24,earned:false},monthly:{...monthlyFixture,earned:[]}}});
  assert.ok(content(f.nodes.get('monthly-archive')).includes('首枚月度徽章'));
  assert.equal(f.nodes.get('error').hidden,true);
});


test('Claude Code controls Star while Codex and Claude children retain their source',async()=>{
  for(const lang of ['zh','en','ja']) {
    const f=await fixture([
      actor('claude-a','claude_code',true,{actor_name:'Claude Code session-a'}),
      actor('main','api',false),
      actor('codex-a','codex',true),
      actor('claude-child','claude_code',true,{actor_name:'Claude Code Agent child',is_subagent:1})
    ],{actor_id:'claude-a'},{lang});
    assert.equal(f.badges.length,3);
    assert.ok(f.badges[0].textContent.startsWith('Star · Claude Code hooks ·'));
    assert.ok(f.badges.some(b=>b.textContent.startsWith('Codex session-a ·')));
    assert.ok(f.badges.some(b=>b.textContent.startsWith('Claude Code Agent child ·')));
  }
});


test('Hook cards mark provider support with corner dots',async()=>{
  const f=await fixture([actor('main','api',false)],{actor_id:'main'});
  const cards=hookCards(f);
  assert.equal(cards.length,34);
  const dots=hook=>{
    const card=cards.find(c=>c.children[0].children[0].textContent===hook);
    return card.children[0].children[1].children.map(dot=>dot.className);
  };
  assert.deepEqual(dots('PreToolUse'),['provider-dot codex','provider-dot claude']);
  assert.deepEqual(dots('Interrupt'),['provider-dot codex']);
  assert.deepEqual(dots('PostToolUse'),['provider-dot codex','provider-dot claude']);
  assert.deepEqual(dots('Setup'),['provider-dot claude']);
  assert.deepEqual(dots('MessageDisplay'),['provider-dot claude']);
  assert.equal(dots('Interrupt')[0] && cards.find(c=>c.children[0].children[0].textContent==='Interrupt').children[0].children[1].children[0].title,'Codex');
  assert.equal(cards.find(c=>c.children[0].children[0].textContent==='MessageDisplay').children[0].children[1].children[0].title,'Claude Code');
});


function walkNodes(node) {
  return [node,...(node.children || []).flatMap(walkNodes)];
}
function hookCards(f) {
  return walkNodes(f.nodes.get('hooks')).filter(node=>node.dataset?.hook);
}

test('Default lifecycle nests tool loops within turns and covers every supported event once',async()=>{
  const f=await fixture([],{}, {hookCounts:{SessionStart:3,PreToolUse:5,PostToolUseFailure:2,StopFailure:1}});
  const root=f.nodes.get('hooks');
  assert.equal(root.dataset.view,'lifecycle');
  assert.equal(root.className,'hook-lifecycle');
  const main=root.children[0];
  const turn=main.children.find(node=>node.className==='lifecycle-turn');
  const cycle=turn.children.find(node=>node.className==='lifecycle-cycle');
  assert.ok(walkNodes(cycle).some(node=>node.dataset?.hook==='PreToolUse'));
  assert.ok(walkNodes(cycle).some(node=>node.dataset?.hook==='PostToolUseFailure'));
  assert.ok(walkNodes(cycle).some(node=>node.className==='lifecycle-branches'));
  assert.ok(walkNodes(turn).some(node=>node.dataset?.hook==='StopFailure'));
  assert.ok(!walkNodes(turn).some(node=>node.dataset?.hook==='SessionEnd'));
  assert.equal(main.children.at(-1).children.at(-1).children[0].dataset.hook,'SessionEnd');
  const schema=fs.readFileSync('backend/hook_events.py','utf8');
  const claude=[...schema.match(/CLAUDE_HOOKS = \(([\s\S]*?)\)/)[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
  const expected=[...new Set([...hookNames,...claude])].sort();
  assert.deepEqual(hookCards(f).map(card=>card.dataset.hook).sort(),expected);
  assert.ok(f.nodes.get('hook-view-note').textContent.includes('全部会话'));
  assert.ok(f.nodes.get('hook-view-note').textContent.includes('实际顺序'));
  assert.equal(f.nodes.get('error').hidden,true);
});

test('Category view totals original failure events separately and switches without refetching',async()=>{
  const f=await fixture([],{}, {hookCounts:{PreToolUse:8,PostToolUse:6,PostToolUseFailure:2,PostToolBatch:3}});
  const original=hookCards(f).map(card=>[card.dataset.hook,card.children[1].textContent]).sort();
  const requests=f.requests.length;
  await f.hookView('categories');
  assert.equal(f.requests.length,requests);
  assert.equal(f.storage.get('starOffice.hookView'),'categories');
  assert.equal(f.nodes.get('hooks').children.length,8);
  assert.deepEqual(hookCards(f).map(card=>[card.dataset.hook,card.children[1].textContent]).sort(),original);
  const tools=f.nodes.get('hooks').children.find(group=>group.dataset.group==='tools');
  assert.equal(tools.children[0].children[1].textContent,'19 · 接收事件');
  assert.ok(hookCards(f).find(card=>card.dataset.hook==='PostToolUseFailure').className.includes('exceptional seen') ||
    hookCards(f).find(card=>card.dataset.hook==='PostToolUseFailure').className.includes('seen exceptional'));
  await f.hookView('lifecycle');
  assert.equal(f.nodes.get('hooks').dataset.view,'lifecycle');
  assert.deepEqual(hookCards(f).map(card=>[card.dataset.hook,card.children[1].textContent]).sort(),original);
});

test('View preference survives refresh, language, date changes and a new page load',async()=>{
  const storage=new Map();
  const f=await fixture([],{}, {storage});
  await f.hookView('categories');
  const button=f.hookViewButtons[1];
  assert.equal(button.attributes['aria-pressed'],'true');
  assert.equal(f.hookViewButtons[0].attributes['aria-pressed'],'false');
  assert.equal(f.context.document.activeElement,button);
  await f.poll();
  assert.equal(f.context.document.activeElement,button);
  f.language('en');
  assert.ok(f.nodes.get('hook-view-note').textContent.includes('unique tasks'));
  await f.period('7d');
  assert.equal(f.nodes.get('hooks').dataset.view,'categories');
  const loaded=await fixture([],{}, {storage});
  assert.equal(loaded.nodes.get('hooks').dataset.view,'categories');
  loaded.language('ja');
  assert.ok(loaded.nodes.get('hook-view-note').textContent.includes('個別タスク数'));
});

test('Invalid or unavailable browser storage keeps lifecycle available',async()=>{
  const invalid=await fixture([],{}, {storage:new Map([['starOffice.hookView','unknown']])});
  assert.equal(invalid.nodes.get('hooks').dataset.view,'lifecycle');
  const blocked=await fixture([],{}, {storageFails:true});
  assert.equal(blocked.nodes.get('hooks').dataset.view,'lifecycle');
  await blocked.hookView('categories');
  assert.equal(blocked.nodes.get('hooks').dataset.view,'categories');
  assert.equal(blocked.nodes.get('error').hidden,true);
});

test('Selecting a failure event opens its log and preserves date and state filters',async()=>{
  const f=await fixture([],{}, {hookCounts:{PostToolUseFailure:2}});
  await f.period('7d');
  f.nodes.get('state-filter').value='error';
  const card=hookCards(f).find(card=>card.dataset.hook==='PostToolUseFailure');
  assert.equal(card.type,'button');
  assert.ok(card.attributes['aria-label'].includes('2'));
  card.focus();
  await card.listeners.click();
  const url=f.requests.filter(url=>url.startsWith('/api/events')).at(-1);
  const params=new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('hook'),'PostToolUseFailure');
  assert.equal(params.get('state'),'error');
  assert.equal(params.get('period'),'7d');
  assert.equal(f.context.document.activeElement,f.nodes.get('activity-log-title'));
  assert.equal(hookCards(f).find(card=>card.dataset.hook==='PostToolUseFailure').attributes['aria-pressed'],'true');
});

test('Polling and translation preserve focused event cards in both views',async()=>{
  for(const view of ['lifecycle','categories']) {
    const f=await fixture([],{}, {storage:new Map([['starOffice.hookView',view]])});
    hookCards(f).find(card=>card.dataset.hook==='PreToolUse').focus();
    f.stats.hooks.PreToolUse=7;
    await f.poll();
    assert.equal(f.context.document.activeElement.dataset.hook,'PreToolUse');
    assert.equal(f.context.document.activeElement.children[1].textContent,'7');
    assert.ok(hookCards(f).includes(f.context.document.activeElement));
    f.language('en');
    assert.equal(f.context.document.activeElement.dataset.hook,'PreToolUse');
    assert.ok(f.context.document.activeElement.attributes['aria-label'].includes('Before tool'));
    assert.ok(f.context.document.activeElement.attributes['aria-label'].includes('Codex / Claude Code'));
  }
});

test('A failed log request keeps focus on the event card and reports the error',async()=>{
  const f=await fixture([],{}, {statusFails:true});
  const card=hookCards(f).find(card=>card.dataset.hook==='StopFailure');
  card.focus();
  await card.listeners.click();
  assert.equal(f.context.document.activeElement,card);
  assert.equal(f.nodes.get('error').hidden,false);
});


test('Environment events keep related pairs together in both two-column hook views',async()=>{
  for(const view of ['lifecycle','categories']) {
    const f=await fixture([],{}, {storage:new Map([['starOffice.hookView',view]])});
    const group=walkNodes(f.nodes.get('hooks')).find(node=>node.dataset?.group==='environment');
    const hooks=walkNodes(group).filter(node=>node.dataset?.hook).map(card=>card.dataset.hook);
    for(const [left,right] of [
      ['Setup','InstructionsLoaded'],
      ['WorktreeCreate','WorktreeRemove'],
      ['ConfigChange','FileChanged'],
      ['CwdChanged','DirectoryAdded']
    ]) {
      const start=hooks.indexOf(left), end=hooks.indexOf(right);
      assert.ok(start>=0);
      assert.equal(end,start+1);
      assert.equal(Math.floor(start/2),Math.floor(end/2));
    }
  }
});


test('Every hook has a Chinese trigger description in both views and accessible card labels',async()=>{
  for(const view of ['lifecycle','categories']) {
    const f=await fixture([],{}, {storage:new Map([['starOffice.hookView',view]])});
    for(const card of hookCards(f)) {
      const description=card.title.split('\n')[0];
      assert.match(description,/[\u4e00-\u9fff]/);
      assert.ok(description.length>20,card.dataset.hook);
      assert.ok(card.attributes['aria-label'].includes(description),card.dataset.hook);
      assert.ok(card.title.endsWith('查看 '+card.dataset.hook+' 的活动日志'));
    }
    const card=hook=>hookCards(f).find(card=>card.dataset.hook===hook);
    assert.equal(card('Setup').children[2].textContent,'初始化与维护');
    assert.equal(card('DirectoryAdded').children[2].textContent,'工作目录添加');
    assert.equal(card('TaskCompleted').children[2].textContent,'任务完成前');
    assert.equal(card('TeammateIdle').children[2].textContent,'队友空闲前');
    assert.ok(card('StopFailure').title.includes('API 错误'));
    assert.ok(card('PermissionDenied').title.includes('自动模式'));
    assert.ok(card('PostToolUse').title.includes('Codex'));
    assert.ok(card('PostToolUse').title.includes('PostToolUseFailure'));
    assert.ok(card('ElicitationResult').title.includes('即将'));
    assert.ok(card('WorktreeCreate').title.includes('自定义创建器'));
    f.language('en');
    assert.ok(!hookCards(f).find(card=>card.dataset.hook==='Setup').title.includes('显式'));
    assert.ok(hookCards(f).find(card=>card.dataset.hook==='TaskCompleted').children[2].textContent.includes('Before'));
  }
});


test('Board discussion metrics are separate from date-filtered activity and gracefully hide missing data',async()=>{
  const f=await fixture([],{});
  assert.equal(f.nodes.get('board-activity').hidden,true);
  f.stats.agent_board={available:true,summary:{messages:35,threads:21,agents:4,channels:1}};
  await f.poll();
  assert.equal(f.nodes.get('board-activity').hidden,false);
  assert.deepEqual(f.nodes.get('board-activity-metrics').children.map(card=>card.children[1].textContent),['35','21','4','1']);
  await f.period('7d');
  assert.equal(f.nodes.get('board-activity-metrics').children[0].children[1].textContent,'35');
  f.language('en');
  assert.ok(f.nodes.get('board-activity-metrics').children[0].children[0].textContent.includes('Discussion'));
  f.stats.agent_board={available:false,status:'unavailable'};
  await f.poll();
  assert.equal(f.nodes.get('board-activity').hidden,true);
});
