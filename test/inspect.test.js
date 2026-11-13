import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssetIds, classifyAssetMetadata, inspectAssetIds } from '../src/roblox.js';

const account = { kind:'cookie', secret:'never-print-this', userId:'12345' };
const group = { id:'999', name:'Studio Group', canManage:true };
test('pasted IDs parse links, duplicates, and numeric rows', () => {
  assert.deepEqual(parseAssetIds('123, 345\nrbxassetid://123 https://www.roblox.com/library/777/example 0 abc'), ['123','345','777']);
  assert.throws(() => parseAssetIds('123 345 456',2), /Maximum 2/);
});
test('Roblox metadata verifies the actual creator and type, not the pasted claim', () => {
  const make = (creator, typeId=3) => ({AssetId:555, Name:'Track', AssetTypeId:typeId, Creator:creator});
  assert.equal(classifyAssetMetadata(make({CreatorType:'User',CreatorTargetId:12345,Name:'Me'}),account).ownership,'owned');
  assert.equal(classifyAssetMetadata(make({CreatorType:'User',CreatorTargetId:222,Name:'Other'}),account).ownership,'not_owned');
  assert.equal(classifyAssetMetadata(make({CreatorType:'Group',CreatorTargetId:999,Name:'Group'}),account,[group]).ownership,'managed');
  assert.equal(classifyAssetMetadata(make({CreatorType:'Group',CreatorTargetId:999,Name:'Group'}),account).ownership,'unknown');
  assert.equal(classifyAssetMetadata(make({CreatorType:'User',CreatorTargetId:12345,Name:'Me'},333),account).ownership,'unknown');
  assert.equal(classifyAssetMetadata(make({CreatorType:'User',CreatorTargetId:12345,Name:'Me'},24),account).type,'Animation');
});
test('inspect loads actual Roblox metadata and isolates lookup failures without leaking cookies to outsiders', async () => {
  const urls=[];
  const fake = async (url, opts) => {
    urls.push([url,opts.headers.Cookie]);
    const id=url.split('/')[5];
    if(id==='333') return {ok:false,status:404,headers:new Headers(),text:async()=>'{"errors":[{"message":"Not found"}]}' };
    return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({AssetId:Number(id),AssetTypeId:24,Name:'Animation',Creator:{CreatorType:'User',CreatorTargetId:Number(id)==111?12345:900,Name:'Owner'}})};
  };
  const rows=await inspectAssetIds(account,['111','222','333'],[],fake);
  assert.deepEqual(rows.map(x=>x.ownership), ['owned','not_owned','unknown']);
  assert.deepEqual(rows.map(x=>x.type),['Animation','Animation','']);
  assert.equal(urls.length,3);
  assert.ok(urls.every(([u,c])=>u.startsWith('https://economy.roblox.com/')&&c.startsWith('.ROBLOSECURITY=')));
});
