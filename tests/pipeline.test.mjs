import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {zipFiles} from '../site/src/zip.js';
import {importInbox} from '../scripts/import-inbox.mjs';
import {unpackZIP,validateMeta,exists,json,run} from '../scripts/lib.mjs';
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'archive-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function clickWav(){const sr=12000,length=sr*6,b=Buffer.alloc(44+length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);for(let i=0;i<length;i++)b.writeInt16LE(Math.round(Math.sin(i/sr*2*Math.PI*80)*Math.exp(-(i/sr%.5)*30)*24000),44+i*2);return b;}
test('browser ZIP imports, archives, builds metadata and skips draft audio',async t=>{
  const dir=await temporary(t);await fs.mkdir(path.join(dir,'_inbox'));
  const meta={slug:'fixture-song',title:'テスト曲 <safe>',artist:'Test',genre:'Test',status:'public',download:true};
  const blob=zipFiles([{name:'fixture-song/track.json',data:JSON.stringify(meta)},{name:'fixture-song/audio.wav',data:clickWav()}]);
  await fs.writeFile(path.join(dir,'_inbox','song.zip'),Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(await importInbox(dir),['fixture-song']);assert.ok(await exists(path.join(dir,'_uploaded/fixture-song/song.zip')));assert.equal(await exists(path.join(dir,'_inbox/song.zip')),false);
  assert.deepEqual(await importInbox(dir),[]);
  const normalized=await json(path.join(dir,'content/tracks/fixture-song/track.json'));assert.equal(normalized.audio,'original.wav');
  await fs.cp(path.resolve('site'),path.join(dir,'site'),{recursive:true});
  const draft=path.join(dir,'content/tracks/draft-song');await fs.mkdir(draft);await fs.writeFile(path.join(draft,'track.json'),JSON.stringify({...normalized,slug:'draft-song',status:'draft'}));
  run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false'}});
  const catalog=await json(path.join(dir,'dist/catalog.json'));assert.equal(catalog.tracks.length,1);assert.equal(catalog.tracks[0].title,meta.title);assert.ok(Math.abs(catalog.tracks[0].bpm-120)<1);
  assert.ok(await exists(path.join(dir,'dist/music/fixture-song/stream.mp3')));assert.ok(await exists(path.join(dir,'dist/music/fixture-song/original.wav')));assert.equal(await exists(path.join(dir,'dist/music/draft-song')),false);
  const svg=await fs.readFile(path.join(dir,'dist/music/fixture-song/cover.svg'),'utf8');assert.ok(svg.includes('&lt;safe&gt;'));
  normalized.download=false;await fs.writeFile(path.join(dir,'content/tracks/fixture-song/track.json'),JSON.stringify(normalized));
  run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false'}});assert.equal(await exists(path.join(dir,'dist/music/fixture-song/original.wav')),false);
});
test('malicious ZIP paths and corrupted payloads are rejected',async t=>{
  const dir=await temporary(t);
  for(const name of ['../outside.txt','/outside.txt','foo/../../outside.txt','C:/outside.txt','foo\\outside.txt']){
    const b=Buffer.from(await zipFiles([{name,data:'bad'}]).arrayBuffer());await assert.rejects(unpackZIP(b,dir),/Unsafe/);
  }
  const b=Buffer.from(await zipFiles([{name:'ok.txt',data:'hello'}]).arrayBuffer());b[36]^=1;await assert.rejects(unpackZIP(b,dir),/checksum/);
});
test('duplicate slugs fail without overwriting or archiving the new input',async t=>{
  const dir=await temporary(t);await fs.mkdir(path.join(dir,'_inbox'));
  const blob=Buffer.from(await zipFiles([{name:'track.json',data:JSON.stringify({slug:'same',title:'Same',artist:'Test'})},{name:'a.wav',data:clickWav()}]).arrayBuffer());
  await fs.writeFile(path.join(dir,'_inbox/a.zip'),blob);await importInbox(dir);await fs.writeFile(path.join(dir,'_inbox/b.zip'),blob);await assert.rejects(importInbox(dir),/already exists/);assert.ok(await exists(path.join(dir,'_inbox/b.zip')));
});
test('metadata validation rejects unsafe types and invalid tempos',()=>{
  for(const extra of [{tags:'bad'},{title:[]},{bpm:NaN},{bpm:241},{status:'private'},{download:'yes'}])assert.throws(()=>validateMeta({title:'Song',artist:'Artist',...extra}));
});
test('command upload commits only its track and preserves unrelated staged edits',async t=>{
  const dir=await temporary(t),repo=path.join(dir,'repo'),remote=path.join(dir,'remote.git');await fs.mkdir(repo);await fs.mkdir(path.join(repo,'scripts'));await fs.writeFile(path.join(repo,'scripts/import-inbox.mjs'),'// marker');
  run('git',['init','--bare',remote]);run('git',['init','-b','main'],{cwd:repo});run('git',['config','user.name','Test'],{cwd:repo});run('git',['config','user.email','test@example.invalid'],{cwd:repo});
  await fs.writeFile(path.join(repo,'unrelated.txt'),'original');run('git',['add','.'],{cwd:repo});run('git',['commit','-m','initial'],{cwd:repo});run('git',['remote','add','origin',remote],{cwd:repo});
  await fs.writeFile(path.join(repo,'unrelated.txt'),'uncommitted user edit');run('git',['add','unrelated.txt'],{cwd:repo});
  const audio=path.join(dir,'source.wav');await fs.writeFile(audio,clickWav());
  run(process.execPath,[path.resolve('scripts/upload.mjs'),audio,'--title','CLI Song','--artist','Test'],{cwd:repo});
  assert.equal(run('git',['show','HEAD:unrelated.txt'],{cwd:repo}),'original');assert.ok(run('git',['diff','--cached','--name-only'],{cwd:repo}).includes('unrelated.txt'));
  assert.equal(run('git',['rev-parse','HEAD'],{cwd:repo}),run('git',['--git-dir',remote,'rev-parse','refs/heads/main']));
  const entries=await fs.readdir(path.join(repo,'_inbox'));assert.equal(entries.length,1);assert.equal((await json(path.join(repo,'_inbox',entries[0],'track.json'))).title,'CLI Song');
});
