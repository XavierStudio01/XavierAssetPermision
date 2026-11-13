#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const OWNER='XavierStudio01', REPO='XavierAssetPermision';
const here=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.resolve(here,'../package.json'),'utf8'));
const version=manifest.version, args=process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`XAVIER STUDIO ASSET PERMISION v${version}\n\nXavierAssetPermision [--no-browser] [--no-update] [--port NUMBER]\nXavierAssetPermision --version\n\nLaunches the dashboard and checks the official GitHub Release for updates.`);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {console.log(version);process.exit(0);}
const i=args.indexOf('--port'), port=i===-1?0:Number(args[i+1]);
if (!Number.isInteger(port) || port<0 || port>65535) {console.error('Invalid --port (0–65535)');process.exit(1);}

function newer(a,b) {
  const parse=v=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const lhs=parse(a),rhs=parse(b);if (!lhs||!rhs) return false;
  for (let i=0;i<3;i++) if (lhs[i]!==rhs[i]) return lhs[i]>rhs[i];
  return false;
}
// npm on Windows writes both .cmd and .ps1 launchers. The .ps1 may be blocked by
// restrictive PowerShell execution policy even though the .cmd launcher works.
// Only remove this app's PowerShell shims, and only if the CMD counterpart exists.
async function ensureCmdLaunchers() {
  if (process.platform!=='win32') return;
  const result=spawnSync('cmd.exe',['/d','/s','/c','npm.cmd prefix -g'],{encoding:'utf8',windowsHide:true,timeout:10000});
  if (result.status!==0 || !result.stdout?.trim()) return;
  const prefix=result.stdout.trim().split(/\r?\n/).at(-1).trim();
  for (const command of ['XavierAssetPermision','xavierassetpermision','xavierasetpermision','xavierassetpermission']) {
    const base=path.join(prefix,command);
    try {await fs.access(base+'.cmd');await fs.unlink(base+'.ps1');}catch {/* Absent/locked: CMD shim remains accessible. */}
  }
}
async function updateFromRelease() {
  if(args.includes('--no-update') || process.env.XAVIER_UPDATE_CHECKED==='1') return false;
  let release;
  try {
    const res=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,{
      headers:{Accept:'application/vnd.github+json','User-Agent':`XavierAssetPermision/${version}`},signal:AbortSignal.timeout(4000)
    });
    if(!res.ok)return false;release=await res.json();
  } catch{return false;}
  const tag=String(release.tag_name||'');
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag) || !newer(tag,version))return false;
  const source=`https://github.com/${OWNER}/${REPO}/archive/refs/tags/${tag}.tar.gz`;
  console.log(`[XavierAssetPermision] Update ${tag} found, installing...`);
  const isWindows=process.platform==='win32';
  const command=isWindows?'cmd.exe':'npm';
  const parameters=isWindows?['/d','/s','/c',`npm.cmd install --global "${source}" --no-audit --no-fund`]:['install','--global',source,'--no-audit','--no-fund'];
  const res=spawnSync(command,parameters,{stdio:'inherit',timeout:120000,windowsHide:false});
  if(res.error || res.status!==0){console.warn('[XavierAssetPermision] Update failed; starting current version.');return false;}
  await ensureCmdLaunchers();
  console.log(`[XavierAssetPermision] Updated to ${tag}, restarting...`);
  const other=args.filter(x=>x!=='--no-update' && x!=='--no-browser');
  // Run the updated shim through cmd.exe on Windows, never through a PowerShell .ps1.
  const executable=isWindows?'cmd.exe':'XavierAssetPermision';
  const parameters2=isWindows?['/d','/s','/c',`XavierAssetPermision.cmd --no-update ${other.map(x=>JSON.stringify(x)).join(' ')}`]:['--no-update',...other];
  const child=spawn(executable,parameters2,{stdio:'inherit',env:{...process.env,XAVIER_UPDATE_CHECKED:'1'}});
  await new Promise(resolve=>{child.once('error',error=>{console.error('Restart failed:',error.message);resolve();});child.once('exit',()=>resolve());});
  return true;
}
function openBrowser(url) {
  if (process.platform==='win32') {
    // ShellExecute default HTTP handler (not a powershell script / browser-specific path).
    const primary=spawnSync('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,timeout:9000});
    if(!primary.error && primary.status===0)return true;
    // Some Windows setups disable rundll32 URL launch; fall back to cmd's start.
    const fallback=spawnSync('cmd.exe',['/d','/s','/c',`start "" "${url}"`],{windowsHide:true,timeout:9000});
    return !fallback.error && fallback.status===0;
  }
  const opener=process.platform==='darwin'?'open':'xdg-open';
  try {
    const child=spawn(opener,[url],{stdio:'ignore',detached:true});
    child.on('error',error=>console.warn(`Browser opener failed: ${error.message}`));
    child.unref();
    return true;
  } catch{return false;}
}

if(!(await updateFromRelease())) {
  try {
    const {startServer}=await import('../src/server.js');
    const app=await startServer({port});
    console.log(`\n  XAVIER STUDIO ASSET PERMISION v${version}\n  Dashboard: ${app.url}\n  Press Ctrl+C to close.\n`);
    // Dashboard server is listening before shell open; always print a usable URL.
    if(!args.includes('--no-browser')) {
      const opened=openBrowser(app.url);
      if(!opened)console.warn(`[XavierAssetPermision] Windows could not open the browser automatically. Copy this link: ${app.url}`);
    }
  }catch(error){console.error(`Startup failed: ${error.message}`);process.exitCode=1;}
}
