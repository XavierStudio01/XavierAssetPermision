'use strict';
// Windows PowerShell picks .ps1 npm shims ahead of .cmd, which breaks under
// Restricted Execution Policy. Remove only these four app-specific .ps1 shims.
// Never alter machine/user Execution Policy, and never remove unrelated shims.
if (process.platform !== 'win32') process.exit(0);
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let prefix = process.env.npm_config_prefix || '';
if (!prefix) {
  try { prefix = execFileSync('cmd.exe',['/d','/s','/c','npm.cmd prefix -g'],{encoding:'utf8',windowsHide:true,timeout:8000}).trim(); }
  catch { process.exit(0); }
}
if (!prefix || !path.isAbsolute(prefix)) process.exit(0);
for (const name of ['XavierAssetPermision','xavierassetpermision','xavierasetpermision','xavierassetpermission']) {
  const file = path.join(prefix,name);
  try {
    if (fs.existsSync(file + '.cmd') && fs.existsSync(file + '.ps1')) {
      fs.unlinkSync(file + '.ps1');
    }
  } catch { /* Global npm permissions may disallow cleanup; .cmd works explicitly. */ }
}
