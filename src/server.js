import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault.js';
import { scanRobloxFile } from './file-scanner.js';
import { authenticateCookie, normalizeCookie, getFriends, getGroups, getCreations, inspectAssetIds, parseAssetIds, grantBatch, TYPES, PUBLIC_TYPES, validatePlan } from './roblox.js';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 128 * 1024 * 1024;
const jobs = new Map();
const recent = [];
const inspected = new Map(); // Per-account, local-memory server-side verification; never trust client-supplied ownership.
const managedGroupCache = new Map();
const VERIFY_TTL = 20 * 60 * 1000;
function verificationKey(account, assetId) { return `${account}:${assetId}`; }
async function groupsFor(accountId, auth) {
  const prior = managedGroupCache.get(accountId);
  if (prior && Date.now() - prior.at < VERIFY_TTL) return prior.groups;
  const groups = await getGroups(auth, auth.userId);
  managedGroupCache.set(accountId, { at: Date.now(), groups });
  return groups;
}
function getVerified(accountId, assetId) {
  const item = inspected.get(verificationKey(accountId, assetId));
  return item && Date.now() - item.at < VERIFY_TTL ? item.asset : null;
}
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const cleanError = e => String(e?.message || e).slice(0, 400);

function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function fileBody(req) {
  const announced = Number(req.headers['content-length'] || 0);
  if (announced > FILE_LIMIT) throw Object.assign(new Error('RBX file exceeds 128 MB'), { status: 413 });
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > FILE_LIMIT) throw Object.assign(new Error('RBX file exceeds 128 MB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
async function body(req) { let chunks = [], size = 0; for await (const c of req) { size += c.length; if (size > LIMIT) throw new Error('Request body too large'); chunks.push(c); } const str = Buffer.concat(chunks).toString('utf8'); return str ? JSON.parse(str) : {}; }
function chunks(arr, length) { const all = []; for (let i = 0; i < arr.length; i += length) all.push(arr.slice(i, i + length)); return all; }
function serialize(job) { return { id: job.id, state: job.state, total: job.total, done: job.done, success: job.success, failed: job.failed, errors: job.errors.slice(-300), started: job.started, ended: job.ended || null, cancel: job.cancel, recipientCount: job.recipientCount, assetCount: job.assetCount }; }

async function executeJob(job, vault) {
  job.state = 'running';
  try {
    const auth = await vault.get(job.accountId);
    for (const recipient of job.recipients) {
      for (const group of chunks(job.assets, 50)) {
        if (job.cancel) { job.state = 'cancelled'; return; }
        try {
          const result = await grantBatch(auth, recipient, group, undefined, job.action);
          const succeeded = new Set((result.successAssetIds || []).map(String));
          const failures = new Map((result.errors || []).map(e => [String(e.assetId), String(e.code || 'Failed')]));
          for (const asset of group) {
            if (succeeded.has(asset.id)) job.success++;
            else { job.failed++; if (job.errors.length < 1000) job.errors.push({ asset: asset.id, recipient: `${recipient.type}:${recipient.id}`, reason: failures.get(asset.id) || 'Not confirmed by Roblox' }); }
          }
        } catch (e) {
          for (const asset of group) { job.failed++; if (job.errors.length < 1000) job.errors.push({ asset: asset.id, recipient: `${recipient.type}:${recipient.id}`, reason: cleanError(e) }); }
        }
        job.done += group.length;
        await pause(650);
      }
    }
    job.state = 'completed';
  } catch (e) { job.state = 'failed'; job.errors.push({ reason: cleanError(e) }); }
  finally { job.ended = new Date().toISOString(); recent.unshift(serialize(job)); recent.length = Math.min(recent.length, 25); }
}

export async function startServer({ port = 0, browser = true } = {}) {
  const vault = new Vault(); await vault.load();
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const chosenPort = server.address()?.port;
    const host = req.headers.host || '';
    if (![`127.0.0.1:${chosenPort}`, `localhost:${chosenPort}`].includes(host)) return json(res, 403, { error: 'Invalid local host' });
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${chosenPort}`, `http://localhost:${chosenPort}`].includes(origin)) return json(res, 403, { error: 'Cross-origin requests blocked' });
    try {
      const url = new URL(req.url, `http://${host}`);
      if (!url.pathname.startsWith('/api/')) {
        const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(requested)) return json(res, 404, { error: 'Not found' });
        const file = await fs.readFile(path.join(WEB, requested), 'utf8');
        res.writeHead(200, { 'Content-Type': mime[path.extname(requested)], 'Cache-Control': 'no-store' });
        res.end(requested === 'index.html' ? file.replace('%%LOCAL_TOKEN%%', token) : file);
        return;
      }
      if (req.headers['x-xavier-local-token'] !== token) return json(res, 403, { error: 'Local app token missing' });
      if (req.method === 'POST' && url.pathname === '/api/scan-file') {
        const fileName = req.headers['x-rbx-filename'];
        if (typeof fileName !== 'string' || fileName.length > 300 || /[\r\n]/.test(fileName)) throw new Error('Invalid file name');
        if (!/^application\/octet-stream(?:;|$)/i.test(String(req.headers['content-type'] || ''))) throw new Error('RBX file expected');
        return json(res, 200, await scanRobloxFile(decodeURIComponent(fileName), await fileBody(req)));
      }
      if (req.method === 'GET' && url.pathname === '/api/accounts') return json(res, 200, { accounts: vault.list() });
      if (req.method === 'GET' && url.pathname === '/api/types') return json(res, 200, { types: TYPES, publicTypes: [...PUBLIC_TYPES], version: '1.3.1' });
      if (req.method === 'POST' && url.pathname === '/api/accounts') {
        const b = await body(req);
        const kind = b.kind;
        if (!['cookie', 'apiKey'].includes(kind) || typeof b.secret !== 'string' || b.secret.length < 12 || b.secret.length > 20000) throw new Error('Enter a valid Roblox cookie or API key');
        let metadata;
        if (kind === 'cookie') { b.secret = normalizeCookie(b.secret); metadata = await authenticateCookie(b.secret); }
        else {
          if (!/^\d{1,17}$/.test(String(b.userId)) || !Number.isSafeInteger(Number(b.userId))) throw new Error('API Key account requires a numeric Roblox User ID');
          metadata = { userId: String(b.userId), username: `API Key · ${b.userId}`, displayName: 'Open Cloud' };
        }
        const created = await vault.add({ kind, secret: b.secret, ...metadata });
        return json(res, 201, { account: created, persistent: vault.persist });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) { const id=url.pathname.slice('/api/accounts/'.length); await vault.remove(id); for (const k of inspected.keys()) if (k.startsWith(`${id}:`)) inspected.delete(k); managedGroupCache.delete(id); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/groups') {
        const auth = await vault.get(url.searchParams.get('account'));
        return json(res, 200, { groups: await getGroups(auth, auth.userId) });
      }
      if (req.method === 'GET' && url.pathname === '/api/friends') {
        const auth = await vault.get(url.searchParams.get('account'));
        return json(res, 200, { friends: await getFriends(auth, auth.userId) });
      }
      if (req.method === 'GET' && url.pathname === '/api/assets') {
        const auth = await vault.get(url.searchParams.get('account'));
        const assets = await getCreations(auth, url.searchParams.get('type'), url.searchParams.get('cursor') || '');
        const accountId = url.searchParams.get('account');
        for (const a of assets.assets) inspected.set(verificationKey(accountId, a.id), { at: Date.now(), asset: { ...a, source: 'library', ownership: 'listed', verified: true } });
        return json(res, 200, assets);
      }
      if (req.method === 'POST' && url.pathname === '/api/inspect') {
        const b = await body(req);
        if (!Array.isArray(b.assetIds) || b.assetIds.length < 1 || b.assetIds.length > 75) throw new Error('Select 1–75 IDs per verification request');
        const ids = parseAssetIds(b.assetIds.join('\n'), 75);
        if (ids.length !== b.assetIds.length) throw new Error('Invalid or duplicated asset IDs');
        const auth = await vault.get(b.accountId);
        let groups = [];
        try { groups = await groupsFor(b.accountId, auth); } catch { /* Group ownership remains unknown without Roblox role evidence. */ }
        const assets = [];
        const pending = [];
        for (const id of ids) {
          const cached = getVerified(b.accountId, id);
          if (cached?.source === 'paste') assets.push(cached);
          else pending.push(id);
        }
        if (pending.length) {
          for (const a of await inspectAssetIds(auth, pending, groups)) {
            const verified = { ...a, source: 'paste' };
            if (a.verified) inspected.set(verificationKey(b.accountId, a.id), { at: Date.now(), asset: verified });
            else inspected.delete(verificationKey(b.accountId, a.id));
            assets.push(verified);
          }
        }
        return json(res, 200, { assets: ids.map(id => assets.find(a => a.id === id)) });
      }
      if (req.method === 'POST' && url.pathname === '/api/preview') {
        const b = await body(req);
        const plan = validatePlan(b.assets, b.recipients, b.action || 'Use');
        return json(res, 200, { assetCount: plan.assets.length, recipientCount: plan.recipients.length, grants: plan.grants });
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const b = await body(req);
        if (!b.accountId) throw new Error('Choose a Roblox account');
        await vault.get(b.accountId);
        // All assets must have been resolved on this server through Roblox, never just client claims.
        const trusted = [];
        if (!Array.isArray(b.assets)) throw new Error('Invalid assets');
        for (const entry of b.assets) {
          const match = getVerified(b.accountId, String(entry.id));
          if (!match || !match.verified || !match.type) throw new Error(`Asset ${String(entry.id).slice(0,22)} is not verified for this account. Scan or check pasted IDs again.`);
          if (entry.type !== match.type) throw new Error(`Asset ${match.id} type mismatch. Refresh its metadata.`);
          trusted.push({ id: match.id, type: match.type, source: match.source });
        }
        const plan = validatePlan(trusted, b.recipients, b.action || 'Use');
        plan.assets = plan.assets.map(asset => ({ ...asset, source: getVerified(b.accountId, asset.id)?.source || 'library' }))
          .sort((x, y) => (x.source === 'paste' ? -1 : 0) - (y.source === 'paste' ? -1 : 0));
        if ([...jobs.values()].some(j => j.accountId === b.accountId && ['running','queued'].includes(j.state))) throw new Error('A batch is already running for this Roblox account');
        const job = { id: crypto.randomUUID(), accountId: b.accountId, ...plan, total: plan.grants, assetCount: plan.assets.length, recipientCount: plan.recipients.length, done: 0, success: 0, failed: 0, state: 'queued', cancel: false, errors: [], started: new Date().toISOString() };
        jobs.set(job.id, job);
        if (jobs.size > 50) { const first = [...jobs.keys()][0]; if (first !== job.id && ['completed', 'cancelled', 'failed'].includes(jobs.get(first).state)) jobs.delete(first); }
        void executeJob(job, vault);
        return json(res, 201, { job: serialize(job) });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') return json(res, 200, { jobs: recent });
      const jobPath = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(\/cancel)?$/);
      if (jobPath) {
        const job = jobs.get(jobPath[1]); if (!job) return json(res, 404, { error: 'Job not found' });
        if (req.method === 'GET' && !jobPath[2]) return json(res, 200, { job: serialize(job) });
        if (req.method === 'POST' && jobPath[2]) { job.cancel = true; return json(res, 200, { job: serialize(job) }); }
      }
      return json(res, 404, { error: 'Endpoint not found' });
    } catch (e) { return json(res, /Invalid|Unsupported|Select |requires|must|Choose|Enter|Account|recipient|asset|Public|Scanning|Request body|No such|numeric/i.test(cleanError(e)) ? 400 : (e.status || 500), { error: cleanError(e) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, persistent: vault.persist };
}
