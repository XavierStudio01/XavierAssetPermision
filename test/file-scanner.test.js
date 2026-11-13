import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRobloxFile } from '../src/file-scanner.js';
import { startServer } from '../src/server.js';
import { zstdCompressSync } from 'node:zlib';

const bstr=s=>{const buf=Buffer.from(s);const result=Buffer.alloc(4+buf.length);result.writeUInt32LE(buf.length,0);buf.copy(result,4);return result;};
function chunk(name,body,compressed=false){
  const header=Buffer.alloc(16);Buffer.from(name).copy(header);
  header.writeUInt32LE(compressed?body.length:0,4);header.writeUInt32LE(body.length,8);return Buffer.concat([header,body]);
}
function model(property,value){
  const header=Buffer.alloc(32);Buffer.from([0x3c,0x72,0x6f,0x62,0x6c,0x6f,0x78,0x21,0x89,0xff,0x0d,0x0a,0x1a,0x0a]).copy(header);
  const p=Buffer.alloc(4);p.writeUInt32LE(1);
  const prop=Buffer.concat([p,bstr(property),Buffer.from([0x01]),bstr(value)]);
  return Buffer.concat([header,chunk('PROP',prop),chunk('END',Buffer.from('</roblox>'))]);
}
function lz4Literals(input){
  // Valid raw LZ4 block containing only literals (small fixture).
  const out=[Math.min(input.length,15)<<4]; let rem=input.length-15;
  if(input.length>=15){while(rem>=255){out.push(255);rem-=255;}out.push(rem);}
  return Buffer.concat([Buffer.from(out),input]);
}
function compressedModel(prop){
  const header=Buffer.alloc(32);Buffer.from([0x3c,0x72,0x6f,0x62,0x6c,0x6f,0x78,0x21,0x89,0xff,0x0d,0x0a,0x1a,0x0a]).copy(header);
  const compressed=lz4Literals(prop);const ch=Buffer.alloc(16);ch.write('PROP');ch.writeUInt32LE(compressed.length,4);ch.writeUInt32LE(prop.length,8);
  return Buffer.concat([header,ch,compressed,chunk('END',Buffer.from('</roblox>'))]);
}
test('Roblox XML: explicit asset refs and property-only numeric; ignores arbitrary numbers',async()=>{
 const xml='<roblox version="4"><Item class="Sound"><Properties><Content name="SoundId"><url>rbxassetid://123456789</url></Content><String name="Name">Sound 888888888</String><Content name="AnimationId"><url>987654321</url></Content></Properties></Item></roblox>';
 const result=await scanRobloxFile('demo.rbxlx',Buffer.from(xml));
 assert.deepEqual(result.assets.map(x=>x.id),['123456789','987654321']);
 assert.equal(result.requiresVerification,true);
});
test('Roblox binary uncompressed PROP: only reference assets, not random numeric text',async()=>{
 const prop=Buffer.from('SoundId');
 const result=await scanRobloxFile('sound.rbxm',model('SoundId','rbxassetid://18456923895'));
 assert.deepEqual(result.assets.map(x=>x.id),['18456923895']);
 const numeric=await scanRobloxFile('numeric.rbxl',model('SoundId','12345678'));
 assert.deepEqual(numeric.assets.map(x=>x.id),['12345678']);
 const random=await scanRobloxFile('random.rbxl',model('Name','random 9999999999'));
 assert.equal(random.count,0);
});
test('Roblox binary LZ4 PROP chunk, without third-party decompression',async()=>{
 const raw=Buffer.concat([Buffer.alloc(4),bstr('AnimationId'),Buffer.from([1]),bstr('rbxassetid://9344557788')]);
 const r=await scanRobloxFile('dance.rbxm',compressedModel(raw));
 assert.deepEqual(r.assets.map(a=>a.id),['9344557788']);
});
test('Reject non-Roblox and dangerous sizes',async()=>{
 await assert.rejects(()=>scanRobloxFile('bad.txt',Buffer.from('rbxassetid://5432233')),/Choose/);
 await assert.rejects(()=>scanRobloxFile('fake.rbxm',Buffer.from('asset 123456789')),/Roblox XML/);
});
test('File scan API requires token; accepts a genuine RBX file and does not grant automatically',async()=>{
 const {server,url}=await startServer({port:0});
 try {
  const html=await (await fetch(url)).text();
  const token=html.match(/meta name="local-token" content="([a-f0-9]+)"/)?.[1];
  assert.ok(token);
  const buffer=model('SoundId','rbxassetid://123456789');
  const denied=await fetch(url+'/api/scan-file',{method:'POST',body:buffer,headers:{'content-type':'application/octet-stream','x-rbx-filename':'hello.rbxm'}});
  assert.equal(denied.status,403);
  const allowed=await fetch(url+'/api/scan-file',{method:'POST',body:buffer,headers:{'content-type':'application/octet-stream','x-rbx-filename':'hello.rbxm','x-xavier-local-token':token}});
  assert.equal(allowed.status,200);
  const body=await allowed.json();
  assert.equal(body.assets[0].id,'123456789');
  assert.equal(body.requiresVerification,true);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Binary SSTR embedded scripts only extract context-specific references',async()=>{
 const header=Buffer.alloc(32);Buffer.from([0x3c,0x72,0x6f,0x62,0x6c,0x6f,0x78,0x21,0x89,0xff,0x0d,0x0a,0x1a,0x0a]).copy(header);
 const sstr=Buffer.concat([Buffer.alloc(4),Buffer.from([1,0,0,0]),Buffer.alloc(16),bstr('local s = { AnimationId = 18223333999, level = 999999999 }')]);
 const result=await scanRobloxFile('source.rbxl',Buffer.concat([header,chunk('SSTR',sstr),chunk('END',Buffer.from('</roblox>'))]));
 assert.deepEqual(result.assets.map(a=>a.id),['18223333999']);
});

test('Roblox binary ZSTD PROP chunk decompresses natively without npm dependencies', async () => {
 const raw=Buffer.concat([Buffer.alloc(4),bstr('SoundId'),Buffer.from([1]),bstr('rbxassetid://123444555666')]);
 const compressed=zstdCompressSync(raw);
 const header=Buffer.alloc(32);Buffer.from([0x3c,0x72,0x6f,0x62,0x6c,0x6f,0x78,0x21,0x89,0xff,0x0d,0x0a,0x1a,0x0a]).copy(header);
 const ch=Buffer.alloc(16);ch.write('PROP');ch.writeUInt32LE(compressed.length,4);ch.writeUInt32LE(raw.length,8);
 const result=await scanRobloxFile('zstd.rbxm', Buffer.concat([header,ch,compressed,chunk('END',Buffer.from('</roblox>'))]));
 assert.deepEqual(result.assets.map(a=>a.id),['123444555666']);
});
