import test from 'node:test';
import assert from 'node:assert/strict';
import { getFriends, getGroups, normalizeFriendIds, normalizeGroups, normalizeCookie, makeClient } from '../src/roblox.js';
const reply = data => new Response(JSON.stringify(data), { status:200, headers:{'content-type':'application/json'} });
test('friends/find: pagination, ID-only entries, name hydration by users batch', async () => {
  const calls=[];
  const fetcher = async (url, opts) => {
    const u = new URL(url); calls.push(u.pathname+u.search);
    if (u.pathname.endsWith('/friends/find') && !u.searchParams.get('cursor')) return reply({PageItems:[{id:101},{id:102}],NextCursor:'PAGE2'});
    if (u.pathname.endsWith('/friends/find') && u.searchParams.get('cursor')==='PAGE2') return reply({PageItems:[{id:103}],NextCursor:null});
    if (u.pathname==='/v1/users' && opts.method==='POST') {
      assert.deepEqual(JSON.parse(opts.body).userIds,[101,102,103]);
      return reply({data:[{id:101,name:'user101',displayName:'First'},{id:102,name:'user102',displayName:'Second'},{id:103,name:'user103',displayName:'Third'}]});
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const friends=await getFriends({kind:'cookie',secret:'sample-secret'},42,fetcher);
  assert.deepEqual(friends.map(f=>f.id),['101','102','103']);
  assert.deepEqual(friends.map(f=>f.displayName),['First','Second','Third']);
  assert.equal(calls.filter(x=>x.includes('/friends/find')).length,2);
});
test('friend profile unavailable keeps IDs visible instead of showing empty friends', async () => {
  const fetcher=async(url)=>url.includes('/friends/find')?reply({PageItems:[{id:999}],NextCursor:''}):new Response('{}',{status:503});
  const friends=await getFriends({kind:'cookie',secret:'abc'},10,fetcher);
  assert.equal(friends[0].id,'999');
  assert.equal(friends[0].unresolved,true);
});
test('groups roles and managed group flag are normalized', async () => {
  const fetcher=async(url)=>url.includes('/groups/roles')
   ? reply({data:[{group:{id:10,name:'Cool Group'},role:{rank:255,name:'Owner'}},{group:{id:20,name:'Another'},role:{rank:50,name:'Developer'}}]})
   : reply({data:[{id:20}]});
  const groups=await getGroups({kind:'cookie',secret:'abc'},123,fetcher);
  assert.equal(groups.length,2);
  assert.equal(groups[0].isOwner,true);
  assert.equal(groups[1].canManage,true);
  assert.equal(groups[1].role,'Developer');
});
test('cookie normalization strips prefix without leaking to another host', async () => {
  assert.equal(normalizeCookie('.ROBLOSECURITY=TOKEN123'), 'TOKEN123');
  await assert.rejects(makeClient({kind:'cookie',secret:'token'}).request('https://evil.example.net/api'), /host not allowed/);
});
