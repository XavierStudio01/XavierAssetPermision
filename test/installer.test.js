import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Windows installer packs current directory, avoids quoted source argument, and validates installed CLI', () => {
 const script = fs.readFileSync(path.join(root,'install.cmd'),'utf8');
 assert.match(script,/npm\.cmd pack \. --pack-destination "%PACK_DIR%"/i);
 assert.doesNotMatch(script,/npm\.cmd pack ["']?%~dp0/i);
 assert.match(script,/if not exist "%PACK_FILE%"/i);
 assert.match(script,/XavierAssetPermision\.cmd" --version/i);
 assert.match(script,/rmdir \/s \/q "%PACK_DIR%"/i);
 assert.equal(fs.existsSync(path.join(root,'install.ps1')),false);
});
