import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'XavierAssetPermision') : path.join(os.homedir(), '.xavierassetpermision');
const FILE = path.join(DIR, 'accounts.json');
const PS = `$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); if($env:XAVIER_DPAPI_MODE -eq 'encrypt') { $s=ConvertTo-SecureString -String $v -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s)); } else { $s=ConvertTo-SecureString -String $v; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)); } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }`;

function dpapi(value, mode) {
  if (process.platform !== 'win32') throw new Error('Persistent accounts require Windows DPAPI. Non-Windows use is session-only.');
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')];
    const child = spawn('powershell.exe', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, XAVIER_DPAPI_MODE: mode } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString().slice(0, 200); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`Windows DPAPI failed (${code}): ${err.slice(0, 100)}`)));
    child.stdin.end(value, 'utf8');
  });
}

export class Vault {
  constructor(file = FILE, persist = process.platform === 'win32') { this.file = file; this.persist = persist; this.accounts = []; this.secrets = new Map(); }
  async load() {
    if (!this.persist) return;
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.accounts)) throw new Error('Incompatible vault format');
      this.accounts = saved.accounts;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  list() { return this.accounts.map(({ encrypted, ...safe }) => safe); }
  async add({ kind, secret, userId, username, displayName }) {
    if (!['cookie', 'apiKey'].includes(kind) || !secret || typeof secret !== 'string') throw new Error('A valid authentication method and credential are required');
    // Re-login updates the saved identity rather than creating duplicate cards.
    const existing = this.accounts.find(a => a.kind === kind && String(a.userId) === String(userId));
    const id = existing?.id || crypto.randomUUID();
    const account = { id, kind, userId: String(userId), username: String(username), displayName: String(displayName || username), created: existing?.created || new Date().toISOString(), encrypted: this.persist ? await dpapi(secret, 'encrypt') : '' };
    this.secrets.set(id, secret);
    if (existing) this.accounts[this.accounts.indexOf(existing)] = account;
    else this.accounts.push(account);
    await this.save();
    return this.list().find(a => a.id === id);
  }
  async get(id) {
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new Error('Account not found');
    let secret = this.secrets.get(id);
    if (!secret && this.persist) { secret = await dpapi(account.encrypted, 'decrypt'); this.secrets.set(id, secret); }
    if (!secret) throw new Error('Account must be logged in again');
    return { ...account, secret };
  }
  async remove(id) { const before = this.accounts.length; this.accounts = this.accounts.filter(a => a.id !== id); this.secrets.delete(id); if (this.accounts.length === before) throw new Error('Account not found'); await this.save(); }
  async save() { if (!this.persist) return; await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 }); const temp = this.file + '.tmp'; await fs.writeFile(temp, JSON.stringify({ version: 1, accounts: this.accounts }, null, 2), { mode: 0o600 }); await fs.rename(temp, this.file); }
}
