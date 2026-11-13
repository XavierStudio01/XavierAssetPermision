/** Xavier Studio local Roblox API adapter. Official Roblox hosts only; never logs credentials. */
export const TYPES = ['Audio', 'Animation', 'Model', 'Mesh', 'MeshPart', 'Decal', 'Image', 'Video', 'Place'];
export const PUBLIC_TYPES = new Set(['Decal', 'Image', 'Mesh']);
export const SUPPORTED_TYPES = new Set(TYPES);
export const PERMISSION_ENDPOINT = 'https://apis.roblox.com/asset-permissions-api/v1/assets/permissions';
const API_HOSTS = new Set(['apis.roblox.com', 'itemconfiguration.roblox.com', 'friends.roblox.com', 'users.roblox.com', 'auth.roblox.com', 'groups.roblox.com', 'develop.roblox.com', 'economy.roblox.com']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class RobloxError extends Error {
  constructor(message, status = 0, retryAfter = 0) { super(message); this.name = 'RobloxError'; this.status = status; this.retryAfter = retryAfter; }
}
function responseMessage(status, body) {
  const parts = (body?.errors || []).map(e => e.message || e.code).filter(Boolean);
  return (parts.length ? parts.join('; ') : body?.error?.message || body?.message || `Roblox HTTP ${status}`).slice(0, 450);
}
export function normalizeCookie(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^\.ROBLOSECURITY\s*=\s*/i, '').split(/;\s*(?=[A-Za-z_-]+=)/)[0].trim();
  if (/[\r\n]/.test(stripped) || stripped.length > 20000) throw new Error('Cookie contains invalid characters');
  return stripped;
}
export function makeClient(auth, transport = globalThis.fetch) {
  async function request(url, options = {}, retries = 2) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !API_HOSTS.has(parsed.hostname)) throw new Error('Roblox host not allowed');
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (auth.kind === 'cookie') headers.Cookie = `.ROBLOSECURITY=${normalizeCookie(auth.secret)}`;
    else if (auth.kind === 'apiKey') headers['x-api-key'] = auth.secret;
    let csrf = options.csrf || '';
    for (let attempt = 0; attempt <= retries + 1; attempt++) {
      if (csrf) headers['x-csrf-token'] = csrf;
      let response;
      try {
        response = await transport(parsed.toString(), {
          method: options.method || 'GET', headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          redirect: 'error', signal: AbortSignal.timeout(20000)
        });
      } catch (err) {
        if (attempt < retries) { await sleep(700 * (attempt + 1)); continue; }
        throw new RobloxError(`Roblox connection failed: ${String(err.message || err).slice(0, 160)}`);
      }
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 150) }; }
      if (response.ok) return data;
      const newCsrf = response.headers.get('x-csrf-token');
      if (response.status === 403 && newCsrf && auth.kind === 'cookie' && csrf !== newCsrf) {
        csrf = newCsrf; continue;
      }
      const retryAfter = Math.min(12000, (Number(response.headers.get('retry-after')) || 2) * 1000);
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await sleep(retryAfter * (attempt + 1)); continue;
      }
      throw new RobloxError(responseMessage(response.status, data), response.status, retryAfter);
    }
    throw new RobloxError('Roblox request retry limit exceeded');
  }
  return { request };
}
export async function authenticateCookie(cookie, transport) {
  const user = await makeClient({ kind: 'cookie', secret: normalizeCookie(cookie) }, transport).request('https://users.roblox.com/v1/users/authenticated');
  if (!Number.isSafeInteger(Number(user.id)) || !user.name) throw new RobloxError('Cookie login could not be validated');
  return { userId: String(user.id), username: String(user.name), displayName: String(user.displayName || user.name) };
}
function validId(value) { return /^\d{1,17}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0; }
export function normalizeFriendIds(page) {
  const items = Array.isArray(page.PageItems) ? page.PageItems : Array.isArray(page.data) ? page.data : Array.isArray(page.friends) ? page.friends : [];
  return {
    friends: items.map(x => ({ id: String(x.id ?? x.userId ?? x.Id ?? ''), name: String(x.name || x.username || ''), displayName: String(x.displayName || '') })).filter(x => validId(x.id)),
    cursor: String(page.NextCursor || page.nextPageCursor || page.nextCursor || '')
  };
}
export async function getFriends(auth, userId, transport) {
  const client = makeClient(auth, transport);
  const ids = new Map();
  let cursor = '', seen = new Set(), page = 0;
  try {
    do {
      const url = new URL(`https://friends.roblox.com/v1/users/${encodeURIComponent(userId)}/friends/find`);
      if (cursor) url.searchParams.set('cursor', cursor);
      const data = normalizeFriendIds(await client.request(url.toString(), {}, 2));
      for (const f of data.friends) ids.set(f.id, f);
      cursor = data.cursor;
      page++;
      if (seen.has(cursor) && cursor) throw new RobloxError('Roblox returned repeated friend cursor');
      seen.add(cursor);
    } while (cursor && page < 100);
    if (cursor) throw new RobloxError('Friend pagination stopped at safety limit; retry later');
  } catch (e) {
    if (ids.size) throw e; // Don't silently show a partial friend list as complete.
    // Older endpoint is fallback for installations where /find is unavailable.
    const legacy = normalizeFriendIds(await client.request(`https://friends.roblox.com/v1/users/${encodeURIComponent(userId)}/friends`));
    for (const f of legacy.friends) ids.set(f.id, f);
  }
  const output = [...ids.values()];
  // Roblox's newer friend list API returns IDs only; hydrate names via Users API.
  for (let i = 0; i < output.length; i += 100) {
    const subset = output.slice(i, i + 100);
    try {
      const result = await client.request('https://users.roblox.com/v1/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { userIds: subset.map(x => Number(x.id)), excludeBannedUsers: false }
      }, 2);
      const profiles = new Map((result.data || []).map(p => [String(p.id), p]));
      for (const item of subset) {
        const p = profiles.get(item.id);
        if (p) { item.name = String(p.name || item.id); item.displayName = String(p.displayName || p.name || item.id); }
      }
    } catch { /* ID fallback is explicit; do not fail the entire friend list on profile lookup. */ }
  }
  return output.map(f => ({ id: f.id, name: f.name || `User ${f.id}`, displayName: f.displayName || f.name || `User ${f.id}`, unresolved: !f.name }));
}
export function normalizeGroups(payload, userId) {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.map(entry => {
    const g = entry.group || entry;
    const role = entry.role || {};
    return { id: String(g.id || ''), name: String(g.name || `Group ${g.id}`), role: String(role.name || 'Member'), rank: Number(role.rank || 0), isOwner: Number(role.rank) === 255 || String(g.owner?.userId || '') === String(userId), memberCount: Number(g.memberCount || 0) };
  }).filter(g => validId(g.id));
}
export async function getGroups(auth, userId, transport) {
  const client = makeClient(auth, transport);
  const base = normalizeGroups(await client.request(`https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`), userId);
  if (auth.kind === 'cookie') {
    try {
      const managed = await client.request('https://develop.roblox.com/v1/user/groups/canmanagegamesoritems');
      const manageable = new Set((Array.isArray(managed.data) ? managed.data : Array.isArray(managed) ? managed : []).map(x => String(x.id ?? x.groupId ?? x.group?.id)));
      for (const g of base) g.canManage = manageable.has(g.id) || g.isOwner;
    } catch { for (const g of base) g.canManage = g.isOwner; }
  } else for (const g of base) g.canManage = g.isOwner;
  return base;
}
export function normalizeAssets(payload, type) {
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.assets) ? payload.assets : [];
  return { assets: rows.map(a => ({
    id: String(a.assetId ?? a.id ?? a.asset?.id ?? ''),
    name: String(a.name ?? a.displayName ?? a.assetName ?? a.asset?.name ?? `Asset ${a.id || a.assetId}`),
    type, isArchived: !!a.isArchived
  })).filter(a => validId(a.id)), nextCursor: String(payload.nextPageCursor ?? payload.nextCursor ?? payload.nextPageToken ?? '') };
}
export async function getCreations(auth, type, cursor = '', transport) {
  if (auth.kind !== 'cookie') throw new RobloxError('Scanning private creations requires Roblox cookie login', 400);
  if (!SUPPORTED_TYPES.has(type)) throw new RobloxError('Unsupported asset type', 400);
  const url = new URL('https://itemconfiguration.roblox.com/v1/creations/get-assets');
  url.searchParams.set('assetType', type);
  url.searchParams.set('isArchived', 'false');
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);
  return normalizeAssets(await makeClient(auth, transport).request(url.toString(), {}, 3), type);
}
export function validatePlan(assets, recipients, action = 'Use') {
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 30000) throw new Error('Select 1–30000 assets');
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 2000) throw new Error('Select 1–2000 recipients');
  const ua = new Map(), ur = new Map();
  for (const a of assets) {
    if (!a || !validId(a.id) || !SUPPORTED_TYPES.has(a.type)) throw new Error(`Invalid asset ID/type: ${String(a?.id).slice(0, 30)}`);
    ua.set(String(a.id), { id: String(a.id), type: a.type });
  }
  for (const r of recipients) {
    if (!r || !['User','Group','Universe','All'].includes(r.type) || (r.type !== 'All' && !validId(r.id))) throw new Error('Invalid recipient type or ID');
    const normalized = { type: r.type, id: r.type === 'All' ? '' : String(r.id) };
    ur.set(`${normalized.type}:${normalized.id}`, normalized);
  }
  const a = [...ua.values()], r = [...ur.values()];
  if (!['Use','Edit','Download','CopyFromRcc','UpdateFromRcc'].includes(action)) throw new Error('Unsupported permission action');
  if (r.some(s => s.type === 'All') && r.length > 1) throw new Error('Public / Everyone must be selected alone');
  for (const x of a) for (const y of r) {
    let allowed = false;
    if (action === 'Use') allowed = x.type !== 'Place' && (y.type === 'All' ? PUBLIC_TYPES.has(x.type) : ['User','Group','Universe'].includes(y.type));
    if (action === 'Edit') allowed = x.type === 'Model' && y.type === 'User';
    if (action === 'Download') allowed = x.type === 'Place' && y.type === 'All';
    if (['CopyFromRcc','UpdateFromRcc'].includes(action)) allowed = x.type === 'Place' && y.type === 'Universe';
    if (!allowed) throw new Error(`Unsupported Roblox permission combination: ${x.type} → ${y.type} / ${action}`);
  }
  return { assets: a, recipients: r, action, grants: a.length * r.length };
}
export async function grantBatch(auth, recipient, assets, transport, action = 'Use') {
  const body = { subjectType: recipient.type, subjectId: recipient.id || '', action, requests: assets.map(a => ({ assetId: Number(a.id), grantToDependencies: false })) };
  return makeClient(auth, transport).request(PERMISSION_ENDPOINT, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, 3);
}

/** Resolve pasted IDs from Roblox metadata. Never infer ownership from a valid-looking ID. */
export const ASSET_TYPE_IDS = Object.freeze({ 1:'Image', 3:'Audio', 4:'Mesh', 9:'Place', 10:'Model', 13:'Decal', 24:'Animation', 40:'MeshPart', 62:'Video' });
export function parseAssetIds(raw, limit = 5000) {
  const input = String(raw || '');
  if (input.length > 250000) throw new Error('Pasted text is too long');
  const found = new Set();
  // Roblox asset URLs, rbxassetid://, numeric lines, and CSV. Ignore labels/non-asset text.
  for (const piece of input.split(/[\s,;]+/)) {
    const token = piece.trim();
    if (!token) continue;
    const match = token.match(/^(?:rbxassetid:\/\/|(?:https?:\/\/)?(?:www\.)?roblox\.com\/(?:library|catalog|asset)\/)?(\d{1,17})(?:[/?#].*)?$/i)
      || token.match(/^https?:\/\/(?:www\.)?create\.roblox\.com\/(?:store\/asset|dashboard\/creations\/store)\/(\d{1,17})(?:[/?#].*)?$/i);
    const id = match?.[1];
    if (!id || !validId(id)) continue;
    found.add(String(BigInt(id)));
    if (found.size > limit) throw new Error(`Maximum ${limit} unique asset IDs per paste`);
  }
  return [...found];
}
export function classifyAssetMetadata(raw, auth, managedGroups = []) {
  const assetId = String(raw.AssetId ?? raw.assetId ?? raw.TargetId ?? raw.id ?? '');
  const creator = raw.Creator || raw.creator || {};
  const creatorId = String(creator.CreatorTargetId ?? creator.creatorTargetId ?? creator.Id ?? creator.id ?? '');
  const creatorType = String(creator.CreatorType ?? creator.creatorType ?? '').toLowerCase();
  const creatorName = String(creator.Name ?? creator.name ?? 'Unknown creator');
  const typeId = Number(raw.AssetTypeId ?? raw.assetTypeId);
  const type = ASSET_TYPE_IDS[typeId] || '';
  let ownership = 'unknown';
  let note = 'Creator or asset type unavailable from Roblox';
  if (validId(creatorId) && (creatorType === 'user' || creatorType === 'group')) {
    if (creatorType === 'user' && creatorId === String(auth.userId)) {
      ownership = 'owned'; note = 'Created by this Roblox account';
    } else if (creatorType === 'group') {
      const group = managedGroups.find(g => String(g.id) === creatorId);
      if (group?.canManage || group?.isOwner) {
        ownership = 'managed'; note = `Group-managed asset · ${group.name}`;
      } else if (group) {
        ownership = 'not_owned'; note = 'Group membership does not grant asset management';
      } else {
        // Without complete membership/role information don't guess that group ownership is impossible.
        ownership = 'unknown'; note = 'Group permission could not be verified';
      }
    } else { ownership = 'not_owned'; note = 'Created by another Roblox user'; }
  }
  if (!type && ownership !== 'not_owned') { ownership = 'unknown'; note = 'Roblox returned an unsupported or unknown asset type'; }
  return { id: assetId, type, name: String(raw.Name ?? raw.name ?? `Asset ${assetId}`), ownership,
    creatorName, creatorType: creatorType === 'group' ? 'Group' : creatorType === 'user' ? 'User' : 'Unknown', creatorId, note, verified: ownership === 'owned' || ownership === 'managed' };
}
export async function inspectAssetIds(auth, ids, managedGroups = [], transport) {
  const safe = parseAssetIds(ids.join('\n'), 75);
  const client = makeClient(auth, transport);
  const output = Array(safe.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, safe.length) }, async () => {
    while (next < safe.length) {
      const i = next++, id = safe[i];
      try {
        const raw = await client.request(`https://economy.roblox.com/v2/assets/${id}/details`, {}, 1);
        const data = classifyAssetMetadata(raw, auth, managedGroups);
        output[i] = { ...data, id };
      } catch (e) {
        output[i] = { id, type:'', name:`Asset ${id}`, creatorName:'Unavailable', creatorType:'Unknown', creatorId:'', ownership:'unknown', verified:false, note: `Metadata lookup failed (${e.status || 'network'}): ${e.message}` };
      }
    }
  });
  await Promise.all(workers);
  return output;
}
