import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, normalizeAssets, grantBatch, authenticateCookie, getCreations } from '../src/roblox.js';
const assets = [{ id: '123', type:'Audio' }, { id:'456', type:'Animation' }];
test('batch accepts multiple Roblox assets and users and deduplicates', () => {
  const plan = validatePlan([...assets, assets[0]], [{type:'User',id:'11'},{type:'User',id:'12'}]);
  assert.equal(plan.assets.length, 2); assert.equal(plan.grants, 4);
});
test('public cannot be granted on audio or animation', () => {
  assert.throws(() => validatePlan(assets, [{type:'All', id:''}]), /Unsupported Roblox permission/);
  assert.equal(validatePlan([{id:'55',type:'Decal'}],[{type:'All',id:''}]).grants,1);
});
test('reject unsafe IDs and invalid recipients', () => {
  assert.throws(() => validatePlan([{id:'1; rm -rf',type:'Audio'}],[{type:'User',id:'2'}]));
  assert.throws(() => validatePlan([{id:'999999999999999999',type:'Audio'}],[{type:'User',id:'2'}]));
  assert.throws(() => validatePlan(assets,[{type:'All',id:''},{type:'User',id:'12'}]));
});
test('normalize creation payload and cursor', () => {
  assert.deepEqual(normalizeAssets({data:[{assetId:123,name:'Hello'},{id:456,displayName:'World'}],nextPageCursor:'next'},'Audio'),{
    assets:[{id:'123',name:'Hello',type:'Audio',isArchived:false},{id:'456',name:'World',type:'Audio',isArchived:false}],nextCursor:'next'
  });
});
test('patch permissions sends actual documented payload, no deprecated assetIds', async () => {
  let seen;
  const fetch = async (url, options) => {
    seen = {url, options};
    return new Response(JSON.stringify({successAssetIds:[123],errors:[{assetId:456,code:'CannotManageAsset'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const res = await grantBatch({kind:'apiKey',secret:'test_api_key'}, {type:'User',id:'11'}, assets,fetch);
  assert.equal(seen.options.method,'PATCH'); assert.equal(seen.options.headers['x-api-key'],'test_api_key');
  const payload = JSON.parse(seen.options.body);
  assert.deepEqual(payload,{subjectType:'User',subjectId:'11',action:'Use',requests:[{assetId:123,grantToDependencies:false},{assetId:456,grantToDependencies:false}]});
  assert.equal(res.errors[0].code,'CannotManageAsset');
});
test('cookie authentication calls user endpoint', async () => {
  const u = await authenticateCookie('session_token', async (url, options) => {
    assert.match(options.headers.Cookie, /^\.ROBLOSECURITY=/);
    return new Response(JSON.stringify({id:777,name:'tester',displayName:'Test Person'}),{status:200});
  });
  assert.equal(u.username,'tester');
});
test('creation scan handles cursor and cookie auth', async () => {
  let seen;
  const v = await getCreations({kind:'cookie',secret:'test'},'Animation','cursor-abc',async (url,opts)=> { seen={url,opts}; return new Response(JSON.stringify({data:[],nextPageCursor:''}),{status:200}); });
  assert.equal(v.assets.length,0); assert.match(seen.url,/assetType=Animation/);assert.match(seen.url,/cursor=cursor-abc/);
});
test('CSRF retry uses response token from Roblox', async () => {
  let count=0;
  await grantBatch({kind:'cookie',secret:'fake'}, {type:'User',id:'11'},[{id:'123',type:'Audio'}],async (url, opts) => {
    count++;
    if(count===1) return new Response('{}',{status:403,headers:{'x-csrf-token':'ABC'}});
    assert.equal(opts.headers['x-csrf-token'],'ABC');
    return new Response(JSON.stringify({successAssetIds:[123],errors:[]}),{status:200});
  });
  assert.equal(count,2);
});

test('Model Edit, Place Download, and Place universe operations respect Roblox matrix', () => {
  assert.equal(validatePlan([{id:'10',type:'Model'}],[{type:'User',id:'11'}],'Edit').action,'Edit');
  assert.throws(() => validatePlan([{id:'10',type:'Model'}],[{type:'Group',id:'11'}],'Edit'));
  assert.equal(validatePlan([{id:'10',type:'Place'}],[{type:'All',id:''}],'Download').grants,1);
  assert.equal(validatePlan([{id:'10',type:'Place'}],[{type:'Universe',id:'13'}],'CopyFromRcc').grants,1);
  assert.throws(() => validatePlan([{id:'10',type:'Place'}],[{type:'User',id:'11'}],'Use'));
});
