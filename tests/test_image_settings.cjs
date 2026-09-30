const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',placeholder:'',disabled:false});
    return nodes.get(id);
  };
  const requests = [];
  const config = {ok:true,has_api_key:true,api_key_masked:'****test',base_url:'https://image.example/v1',model:'custom-image',image_mode:'generate'};
  const context = {
    window:{},document:{getElementById:node,addEventListener(){}},
    uiLang:'en',assetDrawerAuthed:false,updateAssetAuthUI(){},
    fetch:async (url,options={}) => {
      requests.push({url,options});
      if (url==='/assets/auth/status') return {json:async()=>({ok:true,authed:true})};
      if (options.method==='POST') return {ok:true,json:async()=>({ok:true})};
      return {ok:true,json:async()=>config};
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('frontend/image-settings.js','utf8'),context);
  return {context,node,requests,settings:context.window.StarImageSettings};
}

test('Saved custom URL and model populate the settings fields',async () => {
  const f=fixture();
  await f.settings.load();
  assert.equal(f.node('image-base-url-input').value,'https://image.example/v1');
  assert.equal(f.node('image-model-input').value,'custom-image');
  assert.equal(f.node('image-mode-input').value,'generate');
  assert.equal(f.context.assetDrawerAuthed,true);
});

test('Editing URL and model with a blank key preserves the request contract',async () => {
  const f=fixture();
  f.node('image-base-url-input').value='https://relay.example/v1';
  f.node('image-model-input').value='my-model';
  f.node('image-mode-input').value='edit';
  await f.settings.save();
  const request=f.requests.find(r=>r.options.method==='POST');
  assert.equal(request.url,'/config/ai');
  assert.deepEqual(JSON.parse(request.options.body),{
    api_key:'',base_url:'https://relay.example/v1',model:'my-model',image_mode:'edit'
  });
  assert.equal(f.node('btn-save-gemini-key').disabled,false);
});

test('Changing languages updates new settings labels',() => {
  const f=fixture();
  f.settings.labels();
  assert.equal(f.node('btn-save-gemini-key').textContent,'Save settings');
  f.context.uiLang='zh'; f.settings.labels();
  assert.equal(f.node('btn-save-gemini-key').textContent,'保存设置');
});
