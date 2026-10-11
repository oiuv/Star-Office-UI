const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function functionSource(html,name,variable) {
  const start=html.indexOf(`        let ${variable} = null;`);
  const tail=html.slice(start);
  const end=tail.slice(20).search(/\n        (?:async )?function (?!fetchStatus\(|fetchGuestAgents\()/);
  assert.ok(start>=0&&end>=0,`Missing ${name}`);
  return tail.slice(0,end+20);
}

for(const file of ['index.html','electron-standalone.html']) {
  const html=fs.readFileSync(`frontend/${file}`,'utf8');
  for(const [name,variable] of [['fetchStatus','statusRequest'],['fetchGuestAgents','guestAgentsRequest']]) {
    test(`${file}: ${name} coalesces slow polls and recovers after network failure`,async()=>{
      const requests=[],errors=[];
      const context={Date,Set,console:{error:(...args)=>errors.push(args)},
        fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
        window:{OfficeShell:{setTitle(){}},starWorking:null},t:()=> 'Office',refreshOfficePlaqueTitle(){},
        normalizeState:state=>state,STATES:{idle:{name:'Idle'}},currentState:'idle',pendingDesiredState:null,
        getStateLabelByState:()=> 'Idle',getStateDetailByState:()=> 'Idle',
        applyVisualState(){},typewriterTarget:'',typewriterText:'',typewriterIndex:0,
        maybeRandomizeDemoVisitors(){},guestAgents:[],getMergedVisitors:()=>[],guestWelcomeInitialized:false,
        lastSeenGuestIds:new Set(),DEMO_MODE:false,renderGuestAgentList(){},renderGuestAgentsInScene(){}};
      vm.createContext(context);vm.runInContext(functionSource(html,name,variable),context);
      const first=context[name]();assert.equal(context[name](),first);assert.equal(requests.length,1);
      requests[0].reject(new Error('offline'));await first;
      const next=context[name]();assert.equal(requests.length,2);assert.equal(context[name](),next);
      requests[1].resolve({json:async()=>name==='fetchStatus'?{state:'idle',detail:'fresh',officeName:'Office'}:[]});
      await next;
      assert.equal(errors.filter(args=>String(args[0]).includes('apply error')).length,0);
      if(name==='fetchStatus')assert.ok(context.typewriterTarget.includes('fresh'));
      const last=context[name]();assert.equal(requests.length,3);requests[2].reject(new Error('offline'));await last;
    });
  }
  test(`${file}: preference reads fall back when storage is blocked`,()=>{
    const source=html.match(/function readPreference\(key\) \{[\s\S]*?\n        \}/)[0];
    const context={localStorage:{getItem(){throw new Error('blocked');}}};
    vm.runInNewContext(source,context);assert.equal(context.readPreference('uiLang'),null);
  });
}
