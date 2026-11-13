const token = document.querySelector('meta[name="local-token"]').content;
const TYPES = ['Audio','Animation','Model','Mesh','MeshPart','Decal','Image','Video','Place'];
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = n => Number(n || 0).toLocaleString('en-US');
const store = { accounts: [], account: '', assets: new Map(), selected: new Set(), recipients: new Map(), friends: [], groups: [], type: 'All', mode: 'library', pasted: new Map(), pasteTicket: 0, verifying: false, scanning: false, scanTicket: 0, job: '', authBusy: false };
let toastTimer, cookieTimer, pollTimer, pasteTimer;
function notify(message, isError = false) {
  const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); el.classList.toggle('error', isError);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 6400);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, cache:'no-store', headers: { 'x-xavier-local-token':token, ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers } });
  const payload = await response.json().catch(() => { throw Error('Invalid response from local backend'); });
  if (!response.ok) throw Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
function show(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('hidden', el.id !== `panel-${name}`));
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.panel === name));
  $('breadcrumb').textContent = ({assets:'Asset Library',permissions:'Permissions',accounts:'Accounts',activity:'Activity'})[name];
  if (name === 'activity') void showHistory();
  if (name === 'permissions') { drawFriends(); drawGroups(); drawRecipients(); }
}
function status(head, detail, scanning = false) {
  $('syncTitle').textContent = head;
  $('syncDetail').textContent = detail;
  $('stopScan').classList.toggle('hidden', !scanning);
  $('syncNotice').querySelector('.pulse-dot').style.opacity = scanning ? '1' : '.6';
}
function countAll() {
  $('navAssets').textContent = fmt(store.assets.size);
  $('navCount').textContent = fmt(store.recipients.size);
  $('foundCount').textContent = fmt(store.assets.size);
  $('selectedCount').textContent = fmt(store.selected.size);
  $('typeCount').textContent = fmt(store.pasted.size);
  $('grantCount').textContent = fmt(store.selected.size * store.recipients.size);
  $('sumAssets').textContent = fmt(store.selected.size);
  $('sumRecipients').textContent = fmt(store.recipients.size);
  $('sumGrants').textContent = fmt(store.selected.size * store.recipients.size);
  $('footerSelected').textContent = `${fmt(store.selected.size)} assets selected`;
  $('recipientTotal').textContent = fmt(store.recipients.size);
}
async function loadAccounts() {
  store.accounts = (await api('/api/accounts')).accounts;
  const select = $('accountSelect');
  if (!store.accounts.some(a => a.id === store.account)) store.account = store.accounts[0]?.id || '';
  select.replaceChildren(new Option('Select Roblox account', ''));
  for (const a of store.accounts) select.append(new Option(`@${a.username} · ${a.kind === 'cookie' ? 'Cookie' : 'Key'}`, a.id));
  select.value = store.account;
  const list = $('accountCards'); list.replaceChildren();
  for (const a of store.accounts) {
    const el = document.createElement('div'); el.className = 'account-item';
    el.innerHTML = `<div><strong>@${escapeHtml(a.username)}</strong><small>ID ${escapeHtml(a.userId)} · ${escapeHtml(a.kind)}${a.id === store.account ? ' · ACTIVE' : ''}</small></div><div><button data-use="${escapeHtml(a.id)}" class="btn tiny subtle">Use</button><button data-remove="${escapeHtml(a.id)}" class="btn tiny subtle">Remove</button></div>`;
    list.append(el);
  }
  if (!store.accounts.length) list.innerHTML = '<div class="placeholder">No saved accounts. Paste a Roblox cookie to begin.</div>';
  $('accountTotal').textContent = fmt(store.accounts.length);
  countAll();
}
function resetAccountData() {
  store.scanTicket++; store.scanning = false; $('scanAll').disabled = false; $('scanType').disabled = false; store.assets.clear(); store.pasted.clear(); store.pasteTicket++; store.verifying=false; store.selected.clear(); store.recipients.clear();
  store.friends = []; store.groups = []; store.job = '';
  $('assetSearch').value = ''; $('friendSearch').value = ''; $('groupSearch').value = ''; $('pasteInput').value = ''; setAssetMode('library', false);
  drawAssets(); drawFriends(); drawGroups(); drawRecipients();
}
async function switchAccount(id, { force = false, fetch = true } = {}) {
  if (!id) return;
  if (store.account === id && !force) return;
  if (!force && store.selected.size && !confirm('Switching owner account clears your current selected assets and recipients. Continue?')) {
    $('accountSelect').value = store.account; return;
  }
  store.account = id;
  resetAccountData();
  await loadAccounts();
  if (fetch) void discover();
}
async function login() {
  if (store.authBusy) return;
  const kind = $('authMode').value, secret = $('authSecret').value.trim();
  if (secret.length < 12) return;
  store.authBusy = true; $('connectAccount').disabled = true;
  $('connectHint').textContent = 'Validating Roblox credentials…';
  try {
    const result = await api('/api/accounts', { method:'POST', body:JSON.stringify({ kind, secret, userId:$('apiUserId').value.trim() }) });
    $('authSecret').value = '';
    await switchAccount(result.account.id, { force: true, fetch: false });
    $('connectHint').textContent = `Connected: @${result.account.username}`;
    notify(`Connected @${result.account.username} — fetching assets, friends and groups`);
    show('assets');
    void discover();
  } catch (error) { $('connectHint').textContent = 'Login failed — review cookie / key'; notify(error.message, true); }
  finally { store.authBusy = false; $('connectAccount').disabled = false; }
}
async function discover() {
  if (!store.account) { show('accounts'); return; }
  const current = store.account;
  status('Fetching Roblox profile data…', 'Friends, groups, and your creation inventory are loading.', true);
  // Profile lookups can fail independently without preventing the asset scan.
  void loadFriends(current);
  void loadGroups(current);
  const me = store.accounts.find(a => a.id === current);
  if (me?.kind === 'cookie') await scanTypes(TYPES, true);
  else status('Open Cloud API key connected', 'Private creation scanning requires a Roblox cookie. Import owned asset IDs manually.');
}
function selectionAsset(id) {
  return store.pasted.get(id) || store.assets.get(id);
}
function eligible(asset) {
  return !!asset && (asset.source !== 'paste' || asset.ownership === 'owned' || asset.ownership === 'managed') && !!asset.type;
}
function setAssetMode(mode, cancelScan = true) {
  store.mode = mode;
  $('panel-assets').classList.toggle('paste-active', mode === 'paste');
  // Switching sources resets the type filter so pending pasted IDs never disappear.
  store.type = 'All';
  document.querySelectorAll('.type-tab').forEach(b => b.classList.toggle('active', b.dataset.type === 'All'));
  const pasted = mode === 'paste';
  $('modeLibrary').classList.toggle('active', !pasted);
  $('modePaste').classList.toggle('active', pasted);
  $('modeLibrary').setAttribute('aria-pressed', String(!pasted));
  $('modePaste').setAttribute('aria-pressed', String(pasted));
  $('pasteStudio').classList.toggle('hidden', !pasted);
  $('scanAll').classList.toggle('hidden', pasted);
  $('scanType').classList.toggle('hidden', pasted);
  if (pasted && cancelScan && store.scanning) {
    store.scanTicket++; store.scanning=false;
    $('scanAll').disabled=false; $('scanType').disabled=false;
    status('Manual ID verification prioritized', 'Library scan was paused. Resume it from My Assets.');
  }
  drawAssets();
}
function visibleAssets() {
  const term = $('assetSearch').value.toLowerCase().trim();
  const items = store.mode === 'paste' ? store.pasted.values() : store.assets.values();
  return [...items].filter(a => (store.type === 'All' || a.type === store.type) && (`${a.name} ${a.id} ${a.creatorName||''} ${a.ownership||''}`).toLowerCase().includes(term));
}
function statusFor(asset) {
  if (asset.source !== 'paste') return ['library','Account library'];
  if (asset.ownership === 'owned') return ['owned','Owned by you'];
  if (asset.ownership === 'managed') return ['managed','Managed group'];
  if (asset.ownership === 'not_owned') return ['not-owned','Not owned'];
  if (asset.ownership === 'pending') return ['pending','Checking…'];
  return ['unknown','Unverified'];
}
function drawAssets() {
  const list = visibleAssets(), rows = $('assetRows'); rows.replaceChildren();
  const allowed = list.filter(eligible);
  $('tableSummary').textContent = `${fmt(list.length)} shown / ${fmt(store.mode === 'paste' ? store.pasted.size : store.assets.size)} total`;
  $('checkVisible').checked = !!allowed.length && allowed.every(a => store.selected.has(a.id));
  $('checkVisible').disabled = !allowed.length;
  if (!list.length) rows.innerHTML = `<tr><td colspan="5" class="placeholder">${store.mode === 'paste' ? 'Paste IDs above to inspect asset ownership and type.' : 'No assets found. Scan the library or choose another category.'}</td></tr>`;
  const fragment = document.createDocumentFragment();
  for (const a of list.slice(0, 240)) {
    const row = document.createElement('tr');
    row.className = a.source === 'paste' ? 'paste-asset' : '';
    const [statusClass, statusLabel] = statusFor(a);
    const creator = a.source === 'paste' ? `<small class="asset-creator">${escapeHtml(a.creatorName || a.note || 'Awaiting verification')}${a.creatorId ? ` · ${escapeHtml(a.creatorId)}` : ''}</small>` : '';
    row.innerHTML = `<td><input type="checkbox" data-asset="${escapeHtml(a.id)}" ${store.selected.has(a.id) && eligible(a) ? 'checked':''} ${eligible(a) ? '' : 'disabled'}></td><td><div class="asset-label"><span class="asset-icon">${a.type === 'Audio' ? '♫' : a.type === 'Animation' ? '◇' : '▣'}</span><span class="asset-title">${escapeHtml(a.name)}${creator}</span></div></td><td><code>${escapeHtml(a.id)}</code></td><td><span class="type-pill">${escapeHtml(a.type || 'Unknown')}</span></td><td><span class="ownership-pill ${statusClass}" title="${escapeHtml(a.note || statusLabel)}">${statusLabel}</span></td>`;
    fragment.append(row);
  }
  rows.append(fragment);
  if (list.length > 240) {
    const info = document.createElement('tr');
    info.innerHTML = `<td colspan="5" class="placeholder">Showing the first 240 results. Search to refine; Select all still covers every eligible item.</td>`;
    rows.append(info);
  }
  $('pasteSummary').textContent = `${fmt([...store.pasted.values()].filter(eligible).length)} eligible / ${fmt(store.pasted.size)} pasted`;
  countAll();
}
function pastedIdsFromText() {
  const ids = new Set();
  let invalid = 0;
  const text = $('pasteInput').value;
  if (text.length > 250000) throw Error('Input exceeds maximum length');
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  for (const piece of parts) {
    const token = piece.trim();
    const match = token.match(/^(?:rbxassetid:\/\/|(?:https?:\/\/)?(?:www\.)?roblox\.com\/(?:library|catalog|asset)\/)?(\d{1,17})(?:[/?#].*)?$/i)
      || token.match(/^https?:\/\/(?:www\.)?create\.roblox\.com\/store\/asset\/(\d{1,17})(?:[/?#].*)?$/i);
    if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[1]))) { invalid++; continue; }
    ids.add(String(BigInt(match[1])));
    if (ids.size > 5000) throw Error('Maximum 5,000 unique IDs per paste');
  }
  return { ids: [...ids], invalid };
}
async function verifyPasted() {
  if (!store.account) { notify('Connect your Roblox account first', true); show('accounts'); return; }
  let incoming;
  try { incoming = pastedIdsFromText(); } catch (e) { notify(e.message, true); return; }
  if (!incoming.ids.length) { notify('Paste one or more valid asset IDs first', true); return; }
  const ticket = ++store.pasteTicket, account = store.account;
  store.verifying = true;
  // Pasted IDs are prioritized: stop background library discovery immediately.
  if (store.scanning) { store.scanTicket++; store.scanning=false; $('scanAll').disabled=false; $('scanType').disabled=false; }
  const retained = new Map();
  for (const id of incoming.ids) retained.set(id, store.pasted.get(id) || { id, type:'', name:`Asset ${id}`, source:'paste', ownership:'pending', note:'Waiting for Roblox metadata' });
  store.pasted = retained;
  setAssetMode('paste',false);
  $('checkPasted').disabled = true;
  for (let index = 0; index < incoming.ids.length; index += 50) {
    if (ticket !== store.pasteTicket || account !== store.account) return;
    const part = incoming.ids.slice(index,index+50);
    $('pasteProgress').textContent = `Verifying ${fmt(Math.min(index+part.length,incoming.ids.length))} / ${fmt(incoming.ids.length)} IDs…`;
    try {
      const response = await api('/api/inspect', { method:'POST', body:JSON.stringify({ accountId:account, assetIds:part }) });
      if (ticket !== store.pasteTicket || account !== store.account) return;
      for (const a of response.assets) {
        store.pasted.set(a.id, a);
        if (!eligible(a)) store.selected.delete(a.id);
        else store.selected.add(a.id);
      }
    } catch (error) {
      if (ticket !== store.pasteTicket) return;
      for (const id of part) {
        store.pasted.set(id,{ id, type:'', name:`Asset ${id}`, ownership:'unknown', source:'paste', note:error.message });
        store.selected.delete(id);
      }
    }
    drawAssets();
  }
  if (ticket !== store.pasteTicket) return;
  store.verifying = false;
  $('checkPasted').disabled = false;
  const approved = [...store.pasted.values()].filter(eligible).length;
  $('pasteProgress').textContent = `Verification finished · ${fmt(approved)} eligible · ${fmt(incoming.ids.length - approved)} blocked/unverified${incoming.invalid ? ` · ${fmt(incoming.invalid)} invalid tokens` : ''}`;
  notify(`${fmt(approved)} pasted assets verified. These assets will be granted first.`, incoming.invalid > 0);
  drawAssets();
}
async function importRbxFile(file) {
  if (!file) return;
  const maxBytes = 128 * 1024 * 1024;
  if (!/\.(rbxl|rbxm|rbxlx|rbxmx)$/i.test(file.name)) { notify('Choose a Roblox .rbxl / .rbxm file (XML variants also supported)',true); return; }
  if (file.size > maxBytes) { notify('The maximum file size is 128 MB',true); return; }
  $('pickRbxFile').disabled = true;
  $('rbxFileStatus').textContent = `Scanning ${file.name}…`;
  try {
    const result = await api('/api/scan-file',{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','x-rbx-filename':encodeURIComponent(file.name)}});
    // Filename is only metadata; ownership is not known from a file.
    const old = $('pasteInput').value.trim();
    const discovered = result.assets.map(a=>a.id);
    if (!discovered.length) {
      $('rbxFileStatus').textContent = `${result.format} · No explicit asset references found`;
      notify('No Roblox asset references found in this file',true);
      return;
    }
    const oldIds = old ? old.split(/[\s,;]+/) : [];
    const merged = [...new Set([...discovered,...oldIds])];
    if (merged.length > 5000) throw Error('Combined import exceeds 5,000 candidate IDs; clear the paste list or split files');
    $('pasteInput').value=merged.join('\n');
    $('rbxFileStatus').textContent=`${file.name}: ${fmt(discovered.length)} candidate references · ownership check required`;
    setAssetMode('paste',false);
    if (!store.account) { notify('IDs extracted. Connect Roblox to verify ownership before granting.',true); return; }
    await verifyPasted();
  } catch (error) { $('rbxFileStatus').textContent=`Import failed: ${error.message}`; notify(error.message,true); }
  finally { $('pickRbxFile').disabled=false; $('rbxFile').value=''; }
}
async function scanTypes(types, automatic = false) {
  if (!store.account) { show('accounts'); notify('Connect Roblox first', true); return; }
  if (store.scanning) { notify('Scanning is already running'); return; }
  const owner = store.accounts.find(a => a.id === store.account);
  if (owner?.kind !== 'cookie') { notify('Private asset scanning requires a Roblox cookie, not an API key', true); return; }
  store.scanning = true;
  const ticket = ++store.scanTicket, account = store.account;
  $('scanAll').disabled = true; $('scanType').disabled = true;
  const errors = [], countBefore = store.assets.size, completed = [];
  try {
    for (const type of types) {
      let cursor = '', seen = new Set(), page = 0;
      while (ticket === store.scanTicket && account === store.account && page < 200) {
        page++;
        status(`Fetching ${type} · page ${page}`, `Loaded ${fmt(store.assets.size)} total assets. ${completed.length}/${types.length} categories finished.`, true);
        try {
          const url = `/api/assets?account=${encodeURIComponent(account)}&type=${encodeURIComponent(type)}&cursor=${encodeURIComponent(cursor)}`;
          const data = await api(url);
          if (ticket !== store.scanTicket || account !== store.account) return;
          for (const a of data.assets) {
            store.assets.set(a.id, { ...a, source: 'library' });
          }
          drawAssets();
          if (!data.nextCursor) break;
          if (seen.has(data.nextCursor)) throw Error('Roblox repeated a page cursor');
          seen.add(data.nextCursor); cursor = data.nextCursor;
        } catch (error) { errors.push(`${type}: ${error.message}`); break; }
      }
      if (page >= 200 && cursor) errors.push(`${type}: page safety limit reached; results may be partial`);
      if (ticket !== store.scanTicket || account !== store.account) return;
      completed.push(type);
    }
    const added = store.assets.size - countBefore;
    if (errors.length) {
      status('Asset scan partially completed', `${fmt(store.assets.size)} assets available. Failed: ${errors.join(' | ').slice(0, 230)}`);
      notify(`Added ${added} assets; ${errors.length} category issue(s). See status bar.`, true);
    } else { status('Asset library synchronized', `${fmt(store.assets.size)} assets loaded across ${completed.length} categories.`); notify(`${fmt(added)} new assets fetched from Roblox`); }
  } finally {
    if (ticket === store.scanTicket) { store.scanning = false; $('scanAll').disabled = false; $('scanType').disabled = false; drawAssets(); }
  }
}
function keyOf(r) { return `${r.type}:${r.id || ''}`; }
function drawRecipients() {
  const target = $('recipientChips'); target.replaceChildren();
  for (const [k, r] of store.recipients) {
    const c = document.createElement('span'); c.className = 'chip';
    c.innerHTML = `<span>${escapeHtml(r.label || `${r.type} ${r.id}`)}</span><button title="Remove recipient" data-rec-remove="${escapeHtml(k)}">×</button>`;
    target.append(c);
  }
  if (!store.recipients.size) target.innerHTML = '<span class="muted">Nobody selected yet</span>';
  $('publicToggle').checked = store.recipients.has('All:');
  document.querySelectorAll('[data-friend]').forEach(x => x.checked = store.recipients.has(`User:${x.dataset.friend}`));
  document.querySelectorAll('[data-group]').forEach(x => x.checked = store.recipients.has(`Group:${x.dataset.group}`));
  countAll();
}
async function loadFriends(targetAccount = store.account) {
  if (!targetAccount) return;
  $('friendList').innerHTML = '<div class="placeholder">Fetching friends and usernames…</div>';
  $('loadFriends').disabled = true;
  try {
    const result = await api(`/api/friends?account=${encodeURIComponent(targetAccount)}`);
    if (targetAccount !== store.account) return;
    store.friends = result.friends;
    drawFriends(); notify(`Detected ${fmt(store.friends.length)} Roblox friends`);
  } catch (error) {
    if (targetAccount === store.account) $('friendList').innerHTML = `<div class="placeholder">Friends fetch failed: ${escapeHtml(error.message)}<br>Use manual User ID or retry.</div>`;
  } finally { $('loadFriends').disabled = false; }
}
async function loadGroups(targetAccount = store.account) {
  if (!targetAccount) return;
  $('groupList').innerHTML = '<div class="placeholder">Fetching group memberships and roles…</div>';
  $('loadGroups').disabled = true;
  try {
    const result = await api(`/api/groups?account=${encodeURIComponent(targetAccount)}`);
    if (targetAccount !== store.account) return;
    store.groups = result.groups;
    drawGroups();
  } catch (error) {
    if (targetAccount === store.account) $('groupList').innerHTML = `<div class="placeholder">Groups fetch failed: ${escapeHtml(error.message)}<br>Add a Group ID manually or retry.</div>`;
  } finally { $('loadGroups').disabled = false; }
}
function drawFriends() {
  const value = $('friendSearch').value.toLowerCase().trim();
  const list = store.friends.filter(x => `${x.displayName} ${x.name} ${x.id}`.toLowerCase().includes(value));
  const target = $('friendList'); target.replaceChildren();
  for (const f of list.slice(0, 400)) {
    const row = document.createElement('label'); row.className = 'recipient-item';
    row.innerHTML = `<input type="checkbox" data-friend="${escapeHtml(f.id)}" ${store.recipients.has(`User:${f.id}`) ? 'checked':''}><span class="avatar">${escapeHtml(f.displayName.slice(0,1).toUpperCase() || 'U')}</span><span><b>${escapeHtml(f.displayName)}</b><small>@${escapeHtml(f.name)} · ${escapeHtml(f.id)}${f.unresolved?' · ID only':''}</small></span>`;
    target.append(row);
  }
  if (!list.length) target.innerHTML = `<div class="placeholder">${store.friends.length ? 'No matching friends' : 'No friends detected yet'}</div>`;
  if (list.length > 400) target.insertAdjacentHTML('beforeend',`<div class="placeholder">Showing 400; search to filter the remaining ${fmt(list.length - 400)}.</div>`);
}
function drawGroups() {
  const value = $('groupSearch').value.toLowerCase().trim();
  const list = store.groups.filter(g => `${g.name} ${g.id} ${g.role}`.toLowerCase().includes(value));
  const target = $('groupList'); target.replaceChildren();
  for (const g of list.slice(0, 400)) {
    const row = document.createElement('label'); row.className = 'recipient-item';
    row.innerHTML = `<input type="checkbox" data-group="${escapeHtml(g.id)}" ${store.recipients.has(`Group:${g.id}`) ? 'checked':''}><span class="avatar">G</span><span><b>${escapeHtml(g.name)}</b><small>Group ${escapeHtml(g.id)} · ${escapeHtml(g.role)}${g.isOwner?' · OWNER':''}</small></span>`;
    target.append(row);
  }
  if (!list.length) target.innerHTML = `<div class="placeholder">${store.groups.length ? 'No matching groups' : 'No groups detected yet'}</div>`;
}
function addRecipient(r) {
  store.recipients.delete('All:'); store.recipients.set(keyOf(r), r); drawRecipients();
}
async function showHistory() {
  try {
    const list = (await api('/api/history')).jobs;
    const target = $('activityList'); target.replaceChildren();
    for (const j of list) {
      const row = document.createElement('div'); row.className='activity-item';
      row.innerHTML = `<div><b>${escapeHtml(j.state.toUpperCase())}</b><small> · ${escapeHtml(j.id.slice(0, 8))}</small><small style="display:block">${escapeHtml(j.started)}</small></div><div><b>${fmt(j.success)} success / ${fmt(j.failed)} failed</b><small style="display:block">${fmt(j.assetCount)} assets × ${fmt(j.recipientCount)} recipients</small></div>`;
      target.append(row);
    }
    if (!list.length) target.innerHTML = '<div class="placeholder">No executed batch jobs in this session.</div>';
  } catch (error) { notify(error.message,true); }
}
function renderJob(j) {
  $('jobBox').classList.remove('hidden');
  $('jobState').textContent = `STATUS: ${j.state.toUpperCase()}`;
  $('jobCounts').textContent = `${fmt(j.done)} / ${fmt(j.total)} processed · ${fmt(j.success)} successful · ${fmt(j.failed)} failed`;
  $('progressBar').style.width = `${Math.round((j.done / (j.total || 1)) * 100)}%`;
  const errors = $('jobErrors'); errors.replaceChildren();
  for (const e of (j.errors || []).slice(-80)) {
    const line = document.createElement('div'); line.textContent = `${e.asset || 'Job'} / ${e.recipient || '-'} — ${e.reason}`; errors.append(line);
  }
  if (['completed','cancelled','failed'].includes(j.state)) { clearInterval(pollTimer); pollTimer = null; $('startBatch').disabled = false; notify(`Batch ${j.state}. ${fmt(j.success)} successful; ${fmt(j.failed)} failed.`, j.failed > 0); }
}
async function pollJob() {
  if (!store.job) return;
  try { const result = await api(`/api/jobs/${encodeURIComponent(store.job)}`); renderJob(result.job); }
  catch (error) { clearInterval(pollTimer); pollTimer=null; notify(error.message,true); $('startBatch').disabled=false; }
}
function bindEvents() {
  document.querySelectorAll('.nav').forEach(b => b.onclick = () => show(b.dataset.panel));
  $('accountShortcut').onclick = () => show('accounts');
  $('backAssets').onclick = () => show('assets');
  $('proceed').onclick = () => show('permissions');
  $('accountSelect').onchange = e => void switchAccount(e.target.value);
  $('accountCards').onclick = async e => {
    const sw = e.target.closest('[data-use]'); if (sw) { await switchAccount(sw.dataset.use); show('assets'); return; }
    const del = e.target.closest('[data-remove]'); if (!del) return;
    if (!confirm('Delete this local stored account?')) return;
    try { await api(`/api/accounts/${encodeURIComponent(del.dataset.remove)}`,{method:'DELETE'}); if (store.account === del.dataset.remove) {store.account=''; resetAccountData();} await loadAccounts(); if (store.account) void discover(); notify('Account removed'); }
    catch (err) { notify(err.message,true); }
  };
  $('authMode').onchange = () => {
    const key = $('authMode').value === 'apiKey';
    $('apiUserBox').classList.toggle('hidden',!key);
    $('secretLabel').textContent = key ? 'OPEN CLOUD API KEY' : '.ROBLOSECURITY COOKIE';
    $('connectHint').textContent = key ? 'Click Connect after entering User ID' : 'Cookie auto-connects after paste';
    clearTimeout(cookieTimer);
  };
  const scheduleAuto = () => {
    clearTimeout(cookieTimer);
    if ($('authMode').value !== 'cookie') return;
    const value = $('authSecret').value.trim();
    if (value.length < 30) return;
    cookieTimer = setTimeout(() => void login(), 600);
  };
  $('authSecret').addEventListener('paste', () => {clearTimeout(cookieTimer); setTimeout(scheduleAuto, 100); });
  $('authSecret').addEventListener('input', scheduleAuto);
  $('connectAccount').onclick = () => void login();
  $('scanAll').onclick = () => void scanTypes(TYPES);
  $('scanType').onclick = () => void scanTypes(store.type === 'All' ? TYPES : [store.type]);
  $('stopScan').onclick = () => { store.scanTicket++; store.scanning=false; $('scanAll').disabled=false; $('scanType').disabled=false; status('Scan stopped','Previously loaded items remain selectable.'); };
  $('assetSearch').oninput = drawAssets;
  document.querySelectorAll('.type-tab').forEach(b => b.onclick = () => {
    store.type = b.dataset.type; document.querySelectorAll('.type-tab').forEach(x => x.classList.toggle('active',x === b)); drawAssets();
  });
  $('assetRows').onchange = e => { const box=e.target.closest('[data-asset]'); if(!box)return; if (box.checked && !eligible(selectionAsset(box.dataset.asset))) { box.checked=false; notify('Ownership is not verified for that ID',true); return; } box.checked?store.selected.add(box.dataset.asset):store.selected.delete(box.dataset.asset); countAll(); };
  $('checkVisible').onchange = e => { for(const a of visibleAssets().filter(eligible)) e.target.checked?store.selected.add(a.id):store.selected.delete(a.id); drawAssets(); };
  $('selectFiltered').onclick = () => { for (const a of visibleAssets().filter(eligible)) store.selected.add(a.id); drawAssets(); };
  $('selectAll').onclick = () => { for (const a of (store.mode === 'paste' ? store.pasted.values() : store.assets.values())) if (eligible(a)) store.selected.add(a.id); drawAssets(); };
  $('clearSelected').onclick = () => { store.selected.clear(); drawAssets(); };
  $('modeLibrary').onclick = () => setAssetMode('library');
  $('modePaste').onclick = () => setAssetMode('paste');
  $('checkPasted').onclick = () => void verifyPasted();
  $('rbxFile').onchange = e => void importRbxFile(e.target.files?.[0]);
  $('pickRbxFile').onclick = () => $('rbxFile').click();
  $('clearPaste').onclick = () => { store.pasteTicket++; store.verifying=false; $('checkPasted').disabled=false; for (const id of store.pasted.keys()) store.selected.delete(id); store.pasted.clear(); $('pasteInput').value=''; $('pasteProgress').textContent='Paste IDs to start checking automatically.'; drawAssets(); };
  const queuePaste = () => { clearTimeout(pasteTimer); if (!$('pasteInput').value.trim()) return; pasteTimer = setTimeout(() => void verifyPasted(), 480); };
  $('pasteInput').addEventListener('input', queuePaste);
  $('pasteInput').addEventListener('paste', () => {clearTimeout(pasteTimer); pasteTimer=setTimeout(() => void verifyPasted(), 180);});
  $('loadFriends').onclick = () => void loadFriends();
  $('loadGroups').onclick = () => void loadGroups();
  $('friendSearch').oninput = drawFriends;
  $('groupSearch').oninput = drawGroups;
  $('friendList').onchange = e => {
    const input=e.target.closest('[data-friend]');if(!input)return;
    const f=store.friends.find(x=>x.id===input.dataset.friend);if(!f)return;
    if(input.checked)addRecipient({type:'User',id:f.id,label:`@${f.name}`});
    else {store.recipients.delete(`User:${f.id}`);drawRecipients();}
  };
  $('groupList').onchange = e => {
    const input=e.target.closest('[data-group]');if(!input)return;
    const g=store.groups.find(x=>x.id===input.dataset.group);if(!g)return;
    if(input.checked)addRecipient({type:'Group',id:g.id,label:g.name});
    else {store.recipients.delete(`Group:${g.id}`);drawRecipients();}
  };
  $('selectFriends').onclick = () => {
    store.recipients.delete('All:'); for(const f of store.friends){const r={type:'User',id:f.id,label:`@${f.name}`};store.recipients.set(keyOf(r),r);}drawRecipients();notify(`Selected ${store.friends.length} friends`);
  };
  $('selectGroups').onclick = () => {
    store.recipients.delete('All:'); for(const g of store.groups){const r={type:'Group',id:g.id,label:g.name};store.recipients.set(keyOf(r),r);}drawRecipients();notify(`Selected ${store.groups.length} groups`);
  };
  $('recipientAdd').onclick = () => {
    const type=$('recipientType').value,id=$('recipientId').value.trim();
    if(!/^\d{1,17}$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0){notify('Enter a valid numeric Roblox ID',true);return;}
    addRecipient({type,id,label:`${type} ${id}`});$('recipientId').value='';
  };
  $('recipientChips').onclick = e => {const b=e.target.closest('[data-rec-remove]');if(!b)return;store.recipients.delete(b.dataset.recRemove);drawRecipients();};
  $('publicToggle').onchange = e => {
    if(e.target.checked){
      const eligible = $('actionType').value === 'Download'?new Set(['Place']):new Set(['Image','Decal','Mesh']);
      if([...store.selected].some(id=>!eligible.has(selectionAsset(id)?.type))){notify('Public permission is not compatible with selected asset types',true);e.target.checked=false;return;}
      store.recipients.clear();store.recipients.set('All:',{type:'All',id:'',label:'Everyone / Public'});
    }else store.recipients.delete('All:');drawRecipients();
  };
  $('startBatch').onclick = async () => {
    if(!store.account){notify('Connect an account first',true);return;}
    if(store.verifying){notify('Finish verifying pasted IDs first',true);return;}
    const payload={accountId:store.account,assets:[...store.selected].map(id=>selectionAsset(id)).filter(eligible).sort((a,b) => (a.source === 'paste' ? -1 : 0) - (b.source === 'paste' ? -1 : 0)),recipients:[...store.recipients.values()],action:$('actionType').value};
    try{
      const plan=await api('/api/preview',{method:'POST',body:JSON.stringify(payload)});
      if(!confirm(`CONFIRM ROBLOX GRANT\n${plan.assetCount} assets × ${plan.recipientCount} recipients = ${fmt(plan.grants)} changes\nPermission: ${payload.action}\nContinue?`))return;
      $('startBatch').disabled=true;
      const created=await api('/api/jobs',{method:'POST',body:JSON.stringify(payload)});
      store.job=created.job.id;renderJob(created.job);
      clearInterval(pollTimer);pollTimer=setInterval(()=>void pollJob(),1300);void pollJob();
    }catch(error){$('startBatch').disabled=false;notify(error.message,true);}
  };
  $('cancelJob').onclick = async () => {if(!store.job)return;try{await api(`/api/jobs/${encodeURIComponent(store.job)}/cancel`,{method:'POST'});notify('Cancellation requested. Current batch is allowed to finish.');}catch(error){notify(error.message,true);}};
  $('refreshHistory').onclick = () => void showHistory();
}
bindEvents();
void loadAccounts().then(() => {
  if (store.account) { status('Saved session detected','Fetching friends, groups, and owned creations automatically.',true); void discover(); }
  else { status('No account connected','Open Accounts and paste your Roblox cookie to begin automatic discovery.'); show('accounts'); }
}).catch(error=>notify(`Startup: ${error.message}`,true));
