/** Read-only offline reference extractor for Roblox XML / binary places and models.
 * Only extracts explicitly formatted asset links or asset-property values.
 * All candidates must be checked against Roblox by the existing /api/inspect endpoint.
 */
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

export const FILE_EXTENSIONS = new Set(['.rbxm', '.rbxl', '.rbxmx', '.rbxlx']);
const HEADER = Buffer.from([0x3c,0x72,0x6f,0x62,0x6c,0x6f,0x78,0x21,0x89,0xff,0x0d,0x0a,0x1a,0x0a]);
const ZSTD_MAGIC = Buffer.from([0x28,0xb5,0x2f,0xfd]);
const ASSET_PROPERTY = /^(?:SoundId|AnimationId|Texture|TextureId|MeshId|MeshContent|ColorMap|ColorMapContent|MetalnessMap|MetalnessMapContent|RoughnessMap|RoughnessMapContent|NormalMap|NormalMapContent|Image|ImageId|ImageContent|Video|VideoId|VideoContent|Asset|AssetId|Face|Graphic|ShirtTemplate|PantsTemplate|PackageLink|LinkedSource|Family|CachedFaceId|Skybox[A-Za-z]*|SunTextureId|MoonTextureId)$/i;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
const MAX_TOTAL = 320 * 1024 * 1024;
const MAX_IDS = 5000;

function validId(s) { return /^\d{1,17}$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s) > 0; }
function readString(buf, at) {
  if (at + 4 > buf.length) throw new Error('Truncated Roblox string length');
  const size = buf.readUInt32LE(at); at += 4;
  if (size > 64 * 1024 * 1024 || at + size > buf.length) throw new Error('Truncated Roblox property string');
  return [buf.toString('utf8', at, at+size), at + size];
}
function lz4Decode(input, length) {
  const dst = Buffer.allocUnsafe(length);
  let p=0, d=0;
  while (p < input.length) {
    const token = input[p++]; let literals = token >> 4;
    if (literals === 15) { let n; do { if (p >= input.length) throw Error('Invalid LZ4 literals'); n=input[p++]; literals+=n; } while(n===255); }
    if (p+literals > input.length || d+literals > length) throw Error('Invalid LZ4 block boundaries');
    input.copy(dst, d, p, p+literals); d+=literals; p+=literals;
    if (p === input.length) break;
    if (p + 2 > input.length) throw Error('Invalid LZ4 offset');
    const back = input.readUInt16LE(p); p+=2;
    if (!back || back > d) throw Error('Invalid LZ4 backreference');
    let span = (token & 15) + 4;
    if ((token & 15) === 15) { let n; do { if(p>=input.length) throw Error('Invalid LZ4 match');n=input[p++];span+=n; } while(n===255); }
    if (d+span > length) throw Error('LZ4 output too long');
    for (let i=0;i<span;i++) dst[d+i]=dst[d+i-back];
    d+=span;
  }
  if (d!==length) throw Error(`LZ4 length mismatch (${d}/${length})`);
  return dst;
}
function collect(text, place, out, {allowNumeric=false} = {}) {
  if (!text) return;
  const add = (raw, evidence) => {
    if (!validId(raw)) return;
    const id = String(BigInt(raw));
    if (!out.has(id) && out.size >= MAX_IDS) return;
    const item = out.get(id) || { id, references: 0, evidence: [] };
    item.references += 1;
    if (item.evidence.length < 3 && !item.evidence.includes(evidence)) item.evidence.push(evidence);
    out.set(id,item);
  };
  // Explicit Roblox content URI / official asset URL, no arbitrary number scanning.
  for (const match of text.matchAll(/rbxassetid:\/\/(\d{1,17})(?!\d)/gi)) add(match[1], `${place}: rbxassetid`);
  for (const match of text.matchAll(/https?:\/\/(?:www\.)?(?:roblox\.com\/(?:library|catalog|asset)\/|create\.roblox\.com\/store\/asset\/)(\d{1,17})(?!\d)/gi)) add(match[1], `${place}: Roblox URL`);
  for (const match of text.matchAll(/https?:\/\/www\.roblox\.com\/asset\/\?[^\s<>"']*?\bid=(\d{1,17})(?!\d)/gi)) add(match[1], `${place}: Roblox asset URL`);
  // Script-style property assignments (must have a relevant property name).
  for (const match of text.matchAll(/\b(SoundId|AnimationId|TextureId|MeshId|ImageId|VideoId|AssetId)\s*[:=]\s*["']?(\d{5,17})(?!\d)/gi)) add(match[2], `${place}: ${match[1]}`);
  if (allowNumeric && /^\s*\d{5,17}\s*$/.test(text)) add(text.trim(), `${place}: asset property`);
}
function scanXml(xml, out) {
  if (!/<roblox\b/i.test(xml.slice(0,2000))) throw Error('This file does not contain Roblox XML');
  collect(xml, 'XML', out);
  // A bare ID inside <Content name="SoundId"> is a property reference; a bare number elsewhere is not.
  for (const match of xml.matchAll(/<(\w+)\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (!ASSET_PROPERTY.test(match[2])) continue;
    const value = match[3].replace(/<[^>]*>/g, '').replace(/&(?:quot|apos|amp|lt|gt);/g, '');
    collect(value, `XML ${match[2]}`, out, {allowNumeric: true});
  }
}
function scanSharedStrings(data, out) {
  if (data.length < 8 || data.readUInt32LE(0) !== 0) return;
  const total = data.readUInt32LE(4);
  if (total > 200000) throw Error('Invalid Roblox shared string count');
  let at=8;
  for(let i=0;i<total;i++) {
    if(at+16>data.length) throw Error('Invalid Roblox SSTR chunk');
    at+=16; // MD5
    const [value,next]=readString(data,at);at=next;
    collect(value, 'SSTR source', out);
  }
}
function scanProp(data, out) {
  if (data.length < 9) throw Error('Invalid Roblox PROP chunk');
  let at = 4;
  const [name, pos] = readString(data,at); at = pos;
  const type = data[at++];
  const relevant = ASSET_PROPERTY.test(name);
  if (type === 0x01 || type === 0x1d) { // String or bytecode: records with 32-bit length, UTF-8 value
    for (let n=0; n<200000 && at+4<=data.length; n++) {
      try {
        const [value,next] = readString(data,at); at=next;
        collect(value, `PROP ${name}`, out, {allowNumeric: relevant});
      } catch { break; }
    }
  } else if (type === 0x22 && relevant) { // Modern Content has URI strings stored in this chunk
    collect(data.toString('latin1',at), `PROP ${name}`, out);
  } else if (relevant) {
    // Covers future content encodings but still requires rbxassetid:// / official URI.
    collect(data.toString('latin1',at), `PROP ${name}`, out);
  }
}
async function scanBinary(buf, out) {
  if (buf.length < 32 || !buf.subarray(0,14).equals(HEADER)) throw Error('Invalid Roblox binary model/place signature');
  let pos=32, expanded=0, chunks=0, reachedEnd=false;
  while (pos + 16 <= buf.length) {
    const name = buf.toString('ascii', pos,pos+4).replace(/\0/g,'');
    const packed = buf.readUInt32LE(pos+4), size = buf.readUInt32LE(pos+8);
    pos+=16; chunks++;
    if (!['META','SSTR','INST','PROP','PRNT','END'].includes(name)) throw Error('Unsupported Roblox binary chunk');
    if (size>MAX_CHUNK || expanded+size>MAX_TOTAL) throw Error('Model exceeds safe decompressed scan limit');
    const n=packed || size;
    if (pos + n > buf.length) throw Error('Truncated Roblox binary chunk');
    const payload=buf.subarray(pos,pos+n);pos+=n;
    if (name==='END') { reachedEnd=true; break; }
    if (name !== 'PROP' && name !== 'SSTR') continue; // Read only properties/source strings, never raw referents.
    let data=payload;
    if (packed) {
      if (payload.subarray(0,4).equals(ZSTD_MAGIC)) {
        if (typeof zstdDecompressSync !== 'function') throw Error('This RBX file uses ZSTD. Use Node.js 22.15+ (24 LTS recommended).');
        data = zstdDecompressSync(payload, { maxOutputLength: size });
      } else data = lz4Decode(payload,size);
      if (data.length!==size) throw Error('Corrupt compressed Roblox property');
    }
    expanded += size;
    if (name === 'SSTR') scanSharedStrings(data,out); else scanProp(data,out);
    if (chunks > 100000) throw Error('Roblox binary chunk safety limit');
  }
  if (!reachedEnd) throw Error('Incomplete Roblox binary file (no END chunk)');
  return chunks;
}
export async function scanRobloxFile(fileName, input) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!FILE_EXTENSIONS.has(ext)) throw Error('Choose .rbxl, .rbxm, .rbxlx, or .rbxmx');
  const buf = Buffer.from(input);
  if (!buf.length || buf.length > MAX_FILE) throw Error('File must be between 1 byte and 128 MB');
  const out = new Map(); let format;
  if (buf.subarray(0,8).toString('ascii') === '<roblox!') {format='Roblox Binary';await scanBinary(buf,out);}
  else {format='Roblox XML';scanXml(buf.toString('utf8'),out);}
  return { format, filename:path.basename(fileName).slice(0,180), assets:[...out.values()], count:out.size, requiresVerification:true };
}
