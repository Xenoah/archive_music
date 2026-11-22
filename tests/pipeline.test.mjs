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
  const meta={slug:'fixture-song',title:'テスト曲 <safe>',artist:'Test',genre:'Test',generationTools:['suno','Claude','Suno'],status:'public',download:true};
  const blob=zipFiles([{name:'fixture-song/track.json',data:JSON.stringify(meta)},{name:'fixture-song/audio.wav',data:clickWav()}]);
  await fs.writeFile(path.join(dir,'_inbox','song.zip'),Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(await importInbox(dir),['fixture-song']);assert.equal(await exists(path.join(dir,'_uploaded/fixture-song/song.zip')),false);assert.equal(await exists(path.join(dir,'_inbox/song.zip')),false);
  assert.deepEqual(await importInbox(dir),[]);
  const normalized=await json(path.join(dir,'content/tracks/fixture-song/track.json'));assert.equal(normalized.audio,'original.wav');assert.deepEqual(normalized.generationTools,['Suno','Claude']);
  await fs.cp(path.resolve('site'),path.join(dir,'site'),{recursive:true});
  const draft=path.join(dir,'content/tracks/draft-song');await fs.mkdir(draft);await fs.writeFile(path.join(draft,'track.json'),JSON.stringify({...normalized,slug:'draft-song',status:'draft'}));
  run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false'}});
  const catalog=await json(path.join(dir,'dist/data/tracks.json'));assert.equal(catalog.tracks.length,1);assert.equal(catalog.tracks[0].title,meta.title);assert.deepEqual(catalog.tracks[0].generationTools,['Suno','Claude']);assert.ok(Math.abs(catalog.tracks[0].bpm-120)<1);
  assert.ok(await exists(path.join(dir,'dist/media/fixture-song/stream.mp3')));assert.ok(await exists(path.join(dir,'dist/media/fixture-song/original.wav')));assert.equal(await exists(path.join(dir,'dist/media/draft-song')),false);
  const html=await fs.readFile(path.join(dir,'dist/t/fixture-song/index.html'),'utf8');assert.ok(html.includes('&lt;safe&gt;'));assert.ok(html.includes('生成ツール: Suno / Claude'));
  assert.ok(await exists(path.join(dir,'dist/media/fixture-song/auto-cover.png')));
  assert.equal(await exists(path.join(dir,'dist/t/draft-song')),false);
  const studio=await json(path.join(dir,'dist/studio/catalog.json'));assert.equal(studio.tracks[0].audio,'../media/fixture-song/stream.mp3');assert.deepEqual(studio.tracks[0].generationTools,['Suno','Claude']);
  const packed=await json(path.join(dir,'dist/media/fixture-song/analysis.json'));assert.ok(packed.wave.n <= 2400);
  const legacy=await json(path.join(dir,'dist/studio/analysis/fixture-song.json'));assert.equal(legacy.peak.length,packed.wave.n);assert.ok(legacy.bucketSize>0);
  normalized.download=false;await fs.writeFile(path.join(dir,'content/tracks/fixture-song/track.json'),JSON.stringify(normalized));
  run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false'}});assert.equal(await exists(path.join(dir,'dist/media/fixture-song/original.wav')),false);
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
  for(const extra of [{tags:'bad'},{title:[]},{bpm:NaN},{bpm:401},{status:'private'},{download:'yes'},{generationTools:42},{generationTools:[true]},{generationTools:['Unknown']}])assert.throws(()=>validateMeta({title:'Song',artist:'Artist',...extra}));
  assert.deepEqual(validateMeta({title:'Song',artist:'Artist'}).generationTools,[]);
  assert.deepEqual(validateMeta({title:'Song',artist:'Artist',generationTools:[]}).generationTools,[]);
});
test('command upload commits only its track and preserves unrelated staged edits',async t=>{
  const dir=await temporary(t),repo=path.join(dir,'repo'),remote=path.join(dir,'remote.git');await fs.mkdir(repo);await fs.mkdir(path.join(repo,'scripts'));await fs.writeFile(path.join(repo,'scripts/import-inbox.mjs'),'// marker');
  run('git',['init','--bare',remote]);run('git',['init','-b','main'],{cwd:repo});run('git',['config','user.name','Test'],{cwd:repo});run('git',['config','user.email','test@example.invalid'],{cwd:repo});
  await fs.writeFile(path.join(repo,'unrelated.txt'),'original');run('git',['add','.'],{cwd:repo});run('git',['commit','-m','initial'],{cwd:repo});run('git',['remote','add','origin',remote],{cwd:repo});
  await fs.writeFile(path.join(repo,'unrelated.txt'),'uncommitted user edit');run('git',['add','unrelated.txt'],{cwd:repo});
  const audio=path.join(dir,'source.wav');await fs.writeFile(audio,clickWav());
  const metadata=path.join(dir,'info.md');await fs.writeFile(metadata,'---\ntitle: Info Title\nartist: Test\nkey: Am\ngenerationTools: [FLSM]\ntags: [cli, markdown]\nstatus: hidden\n---\nMetadata body');
  run(process.execPath,[path.resolve('scripts/upload.mjs'),audio,'--info',metadata,'--title','CLI Song','--tools','suno, Claude, SUNO'],{cwd:repo});
  assert.equal(run('git',['show','HEAD:unrelated.txt'],{cwd:repo}),'original');assert.ok(run('git',['diff','--cached','--name-only'],{cwd:repo}).includes('unrelated.txt'));
  assert.equal(run('git',['rev-parse','HEAD'],{cwd:repo}),run('git',['--git-dir',remote,'rev-parse','refs/heads/main']));
  const entries=await fs.readdir(path.join(repo,'_inbox'));assert.equal(entries.length,1);const submitted=await json(path.join(repo,'_inbox',entries[0],'track.json'));assert.equal(submitted.title,'CLI Song');assert.equal(submitted.key,'Am');assert.equal(submitted.status,'hidden');assert.equal(submitted.description,'Metadata body');assert.deepEqual(submitted.tags,['cli','markdown']);assert.deepEqual(submitted.generationTools,['Suno','Claude']);
});

// Verify the formats brought in by OTODANA and their actual publication boundaries.
test('Markdown sidecars dry-run and archive together, then respect override, base path and hidden pages',async t=>{
  const dir=await temporary(t);await fs.mkdir(path.join(dir,'_inbox'));
  await fs.writeFile(path.join(dir,'_inbox/song.wav'),clickWav());
  await fs.writeFile(path.join(dir,'_inbox/song.md'),'---\nslug: hidden-song\ntitle: "夜の音"\nartist: Test\nbpm: 144\nstatus: hidden\ntags: [night, demo]\ngenerationTools: [FLSM]\ndownload: false\n---\n\n**Markdown description**');
  assert.deepEqual(await importInbox(dir,{dryRun:true}),['hidden-song']);assert.ok(await exists(path.join(dir,'_inbox/song.md')));assert.equal(await exists(path.join(dir,'content/tracks/hidden-song')),false);
  await importInbox(dir);for(const f of ['song.md','song.wav']){assert.equal(await exists(path.join(dir,'_inbox',f)),false);assert.equal(await exists(path.join(dir,'_uploaded/hidden-song',f)),false);}
  const folder=path.join(dir,'content/tracks/hidden-song');
  await fs.writeFile(path.join(folder,'hidden-song.md'),'---\ntitle: Override\nbpm: 150\n---\nNew body');
  await fs.cp(path.resolve('site'),path.join(dir,'site'),{recursive:true});
  run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false',PUBLIC_BASE_PATH:'/archive_music',PUBLIC_SITE:'https://xenoah.github.io'}});
  assert.deepEqual((await json(path.join(dir,'dist/data/tracks.json'))).tracks,[]);
  assert.deepEqual((await json(path.join(dir,'dist/studio/catalog.json'))).tracks,[]);
  const html=await fs.readFile(path.join(dir,'dist/t/hidden-song/index.html'),'utf8');assert.ok(html.includes('Override'));assert.ok(html.includes('New body'));assert.ok(html.includes('noindex, follow'));assert.ok(html.includes('https://xenoah.github.io/archive_music/t/hidden-song/'));assert.ok(html.includes('"bpm":150'));assert.ok(html.includes('生成ツール: FLSM'));assert.ok(html.includes('"generationTools":["FLSM"]'));
  for(const f of ['rss.xml','sitemap.xml'])assert.ok(!(await fs.readFile(path.join(dir,'dist',f),'utf8')).includes('hidden-song'));
  assert.ok(await exists(path.join(dir,'dist/media/hidden-song/stream.mp3')));
});
test('build rejects media traversal and invalid calendar dates before output',async t=>{
  const dir=await temporary(t),folder=path.join(dir,'content/tracks/invalid');await fs.mkdir(folder,{recursive:true});
  await fs.cp(path.resolve('site'),path.join(dir,'site'),{recursive:true});
  await fs.writeFile(path.join(folder,'audio.wav'),clickWav());
  for(const change of [{audio:'../secret.wav'},{cover:'../../private.png'},{createdAt:'2026-02-30'},{generationTools:['Unsupported']}]){
    await fs.writeFile(path.join(folder,'track.json'),JSON.stringify({title:'Bad',artist:'Test',...change}));
    assert.throws(()=>run(process.execPath,[path.resolve('scripts/build.mjs'),dir],{env:{...process.env,INCLUDE_DEMOS:'false'}}),/ビルドを中止/);
    assert.equal(await exists(path.join(dir,'dist')),false);
  }
});
