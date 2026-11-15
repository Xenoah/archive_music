import fs from 'node:fs/promises';
import path from 'node:path';
import {AUDIO,IMAGE,MAX_BYTES,hash,slugify,validateMeta,writeJSON,run,probe,exists} from './lib.mjs';

const args=process.argv.slice(2),filename=args.shift();
if(!filename||filename==='--help'){
  console.log('npm run upload -- <audio> [--title "曲名"] [--artist "作者"] [--genre Electronic] [--cover image.jpg] [--bpm 128] [--draft] [--download] [--prepare-only]');
  process.exit(filename?0:1);
}
const flags=new Set(['draft','download','prepare-only']),allowed=new Set(['title','artist','genre','cover','bpm','license','description']),options={};
while(args.length){const flag=args.shift();if(!flag.startsWith('--'))throw new Error(`Unknown argument: ${flag}`);const key=flag.slice(2);if(flags.has(key))options[key]=true;else if(allowed.has(key)&&args.length&&!args[0].startsWith('--'))options[key]=args.shift();else throw new Error(`Invalid option: ${flag}`);}
const root=run('git',['rev-parse','--show-toplevel']).trim();
if(!await exists(path.join(root,'scripts/import-inbox.mjs')))throw new Error('Run inside the archive_music repository');
if(!options['prepare-only']&&run('git',['branch','--show-current']).trim()!=='main')throw new Error('Switch to main, or use --prepare-only and submit a Pull Request');
const audio=path.resolve(filename),ext=path.extname(audio).toLowerCase();if(!AUDIO.has(ext))throw new Error('Unsupported audio type');
const bytes=await fs.readFile(audio);if(bytes.length>MAX_BYTES)throw new Error('Audio exceeds 95 MiB');
const info=probe(audio),duration=Number(info.format.duration);if(!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>1200)throw new Error('Audio must be at most 20 minutes');
const tags=info.format.tags||{};
const meta=validateMeta({title:options.title||tags.title||path.parse(audio).name,artist:options.artist||tags.artist||'Xenoah',genre:options.genre||tags.genre||'Other',license:options.license||'All rights reserved',description:options.description||'',status:options.draft?'draft':'public',download:!!options.download,bpm:options.bpm===undefined?null:Number(options.bpm)});
const slug=`${slugify(meta.title)}-${hash(bytes).slice(0,8)}`,relative=`_inbox/${slug}`,target=path.join(root,relative);
for(const p of [target,path.join(root,'content/tracks',slug),path.join(root,'_uploaded',slug)])if(await exists(p))throw new Error(`Track already exists: ${slug}`);
if(options.cover&&(!IMAGE.has(path.extname(options.cover).toLowerCase())||(await fs.stat(options.cover)).size>8*1024*1024))throw new Error('Cover must be PNG/JPEG/WebP and at most 8 MiB');
await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'audio'+ext),bytes);await writeJSON(path.join(target,'track.json'),{...meta,slug});
if(options.cover)await fs.copyFile(options.cover,path.join(target,'cover'+path.extname(options.cover).toLowerCase()));
if(options['prepare-only'])console.log(`Prepared ${relative}/ — commit this folder to submit.`);
else{
  run('git',['add','--',relative],{cwd:root});run('git',['commit','--only','-m',`Add music: ${slug}`,'--',relative],{cwd:root});
  try{console.log(run('git',['push','origin','HEAD'],{cwd:root}));console.log('Uploaded. GitHub Actions will import, build and publish the track.');}
  catch(e){console.error('The track is committed locally. Resolve the Git authentication/divergence error and run git push origin HEAD.');throw e;}
}
