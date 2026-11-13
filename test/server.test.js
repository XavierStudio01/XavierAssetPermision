import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
test('local dashboard serves token and rejects external-origin / missing-token API', async () => {
  const {server,url}=await startServer({port:0,browser:false});
  try {
    const front=await fetch(url);
    assert.equal(front.status,200);
    const html=await front.text();
    assert.match(html,/XAVIER STUDIO ASSET PERMISION/);
    const token=html.match(/meta name="local-token" content="([a-f0-9]+)"/)?.[1];
    assert.ok(token);
    const denied=await fetch(`${url}/api/accounts`);
    assert.equal(denied.status,403);
    const allowed=await fetch(`${url}/api/accounts`,{headers:{'x-xavier-local-token':token}});
    assert.equal(allowed.status,200);
    assert.ok(Array.isArray((await allowed.json()).accounts));
    const crossOrigin=await fetch(`${url}/api/accounts`,{headers:{'Origin':'https://attacker.example','x-xavier-local-token':token}});
    assert.equal(crossOrigin.status,403);
    const types=await fetch(`${url}/api/types`,{headers:{'x-xavier-local-token':token}});
    assert.equal((await types.json()).version,'1.3.1');
  } finally { await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
});
