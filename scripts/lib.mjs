import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {crc32} from '../site/src/zip.js';
export const AUDIO=new Set(['.mp3','.wav','.flac','.m4a','.ogg','.oga','.aac','.opus','.aif','.aiff','.webm']);
export const IMAGE=new Set(['.png','.jpg','.jpeg','.webp','.gif','.avif']);
export const MAX_BYTES=95*1024*1024;
export const hash=data=>createHash('sha256').update(data).digest('hex');
export const exists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
export const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export const writeJSON=(p,d)=>fs.writeFile(p,JSON.stringify(d,null,2)+'\n');
export const slugify=s=>s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'track';
export const validSlug=s=>typeof s==='string'&&/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(s);
export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function run(command,args,options={}){
  const r=spawnSync(command,args,{encoding:options.binary?null:'utf8',timeout:180000,maxBuffer:240*1024*1024,...options});
  if(r.error||r.status!==0)throw new Error(`${command}: ${r.error?.message||String(r.stderr).slice(-1600)}`);
  return r.stdout;
}
export async function filesIn(dir){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())throw new Error(`Symbolic links are not accepted: ${e.name}`);
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...await filesIn(p));else if(e.isFile())out.push(p);
  }
  return out.sort();
}
export function validateMeta(m){
  if(!m||typeof m!=='object'||Array.isArray(m))throw new Error('track.json must be an object');
  for(const [key,max] of [['title',160],['artist',120],['album',160],['description',6000],['genre',60],['key',20],['license',100],['createdAt',10]]){
    if(m[key]!==undefined&&(typeof m[key]!=='string'||m[key].length>max))throw new Error(`Invalid ${key}`);
  }
  if(!m.title?.trim()||!m.artist?.trim())throw new Error('title and artist are required');
  if(m.status!==undefined&&!['public','draft','hidden'].includes(m.status))throw new Error('status must be public, draft or hidden');
  if(m.tags!==undefined&&(!Array.isArray(m.tags)||m.tags.length>12||m.tags.some(t=>typeof t!=='string'||t.length>40)))throw new Error('Invalid tags');
  if(m.bpm!==undefined&&m.bpm!==null&&(!Number.isFinite(m.bpm)||m.bpm<20||m.bpm>400))throw new Error('manual bpm must be 20–400');
  if(m.download!==undefined&&typeof m.download!=='boolean')throw new Error('download must be boolean');
  if(m.createdAt&&(!/^\d{4}-\d{2}-\d{2}$/.test(m.createdAt)||!Number.isFinite(Date.parse(m.createdAt))||new Date(m.createdAt).toISOString().slice(0,10)!==m.createdAt))throw new Error('createdAt must be a valid YYYY-MM-DD');
  return {title:m.title.trim(),artist:m.artist.trim(),album:m.album||'',key:m.key||'',description:m.description||'',genre:m.genre||'Other',license:m.license||'All rights reserved',status:m.status||'public',tags:m.tags||[],bpm:m.bpm??null,download:m.download??false,createdAt:m.createdAt||new Date().toISOString().slice(0,10),demo:m.demo===true};
}
export function probe(p){return JSON.parse(run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',p]));}
// Parse central directory; forbid traversal, symlinks, encrypted files and zip bombs.
export async function unpackZIP(buffer,target){
  if(buffer.length>MAX_BYTES)throw new Error('ZIP exceeds 95 MiB');
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid ZIP');
  const count=buffer.readUInt16LE(end+10);let at=buffer.readUInt32LE(end+16),total=0;const entries=[],seen=new Set();
  if(count>32||!count||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('Unsupported ZIP');
  for(let i=0;i<count;i++){
    if(at+46>buffer.length||buffer.readUInt32LE(at)!==0x02014b50)throw new Error('Invalid ZIP entry');
    const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),crc=buffer.readUInt32LE(at+16),packed=buffer.readUInt32LE(at+20),size=buffer.readUInt32LE(at+24),nl=buffer.readUInt16LE(at+28),el=buffer.readUInt16LE(at+30),cl=buffer.readUInt16LE(at+32),mode=buffer.readUInt32LE(at+38)>>>16,local=buffer.readUInt32LE(at+42);
    const name=buffer.subarray(at+46,at+46+nl).toString('utf8');at+=46+nl+el+cl;total+=size;
    if(flags&1||![0,8].includes(method)||(mode&0xf000)===0xa000||total>MAX_BYTES)throw new Error('Unsafe ZIP entry');
    if(!name||name.includes('\\')||name.startsWith('/')||name.includes('\0')||name.split('/').some(s=>s==='..'||s==='.')||/^[A-Za-z]:/.test(name))throw new Error('Unsafe ZIP path');
    if(name.endsWith('/'))continue;
    if(seen.has(name))throw new Error('Duplicate ZIP entry');seen.add(name);
    if(local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid ZIP local header');
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    if(start+packed>buffer.length)throw new Error('Truncated ZIP');
    const raw=buffer.subarray(start,start+packed),data=method===0?raw:inflateRawSync(raw,{maxOutputLength:Math.max(1,size)});
    if(data.length!==size||crc32(data)!==crc)throw new Error('ZIP checksum mismatch');
    entries.push({name,data});
  }
  for(const e of entries){const p=path.join(target,e.name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,e.data);}
}
