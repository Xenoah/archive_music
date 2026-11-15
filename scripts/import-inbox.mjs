import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {AUDIO,IMAGE,MAX_BYTES,exists,filesIn,hash,slugify,validSlug,json,writeJSON,validateMeta,probe,unpackZIP} from './lib.mjs';
import {parseFrontMatter} from './lib/frontmatter.mjs';
import {toList} from './lib/util.mjs';
import {extractCoverArt} from './lib/audio.mjs';

// One song per directory/ZIP; loose audio may have same-stem .md/.json and cover.
export async function importInbox(root, {dryRun=false}={}) {
  const inbox=path.join(root,'_inbox'), content=path.join(root,'content/tracks'), uploaded=path.join(root,'_uploaded');
  for (const dir of [inbox,content,uploaded]) await fs.mkdir(dir,{recursive:true});
  const config=await exists(path.join(root,'site.config.json')) ? await json(path.join(root,'site.config.json')) : {};
  const entries=(await fs.readdir(inbox,{withFileTypes:true})).filter(e=>!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name));
  if (entries.some(e=>e.isSymbolicLink())) throw new Error('Symbolic links are not accepted');
  const claimed=new Set(), groups=[];
  for (const entry of entries) {
    const ext=path.extname(entry.name).toLowerCase();
    if (!entry.isDirectory() && ext!=='.zip' && !AUDIO.has(ext)) continue;
    const source=path.join(inbox,entry.name), sources=[source];
    if (entry.isFile() && AUDIO.has(ext)) {
      const stem=path.parse(entry.name).name;
      for (const side of entries) if (side.isFile() && path.parse(side.name).name===stem && (IMAGE.has(path.extname(side.name).toLowerCase()) || ['.md','.json'].includes(path.extname(side.name).toLowerCase()))) sources.push(path.join(inbox,side.name));
    }
    for (const file of sources) { if(claimed.has(file)) throw new Error(`Ambiguous sidecar: ${path.basename(file)}`); claimed.add(file); }
    groups.push({entry,source,sources});
  }
  const orphan=entries.find(e=>!claimed.has(path.join(inbox,e.name)));
  if (orphan) throw new Error(`Unsupported or unpaired inbox file: ${orphan.name}`);
  const result=[], planned=new Set();
  for (const {entry,source,sources} of groups) {
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'music-import-'));
    try {
      let files;
      if(entry.isDirectory()) files=await filesIn(source);
      else if(path.extname(entry.name).toLowerCase()==='.zip') { await unpackZIP(await fs.readFile(source),temp); files=await filesIn(temp); }
      else files=sources;
      const audios=files.filter(f=>AUDIO.has(path.extname(f).toLowerCase()));
      if(audios.length!==1) throw new Error('One audio file per track is required');
      const audio=audios[0];
      if((await fs.stat(audio)).size>MAX_BYTES) throw new Error('Audio exceeds 95 MiB');
      const bytes=await fs.readFile(audio), info=probe(audio), duration=Number(info.format.duration);
      if(!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>1200) throw new Error('Audio must be at most 20 minutes');
      const metas=files.filter(f=>['.json','.md'].includes(path.extname(f).toLowerCase()) && !['analysis.json'].includes(path.basename(f)));
      if(metas.length>1) throw new Error('Use one metadata file: track.json, info.json or Markdown');
      let raw={};
      if(metas[0]) {
        if(path.extname(metas[0]).toLowerCase()==='.md') { const md=parseFrontMatter(await fs.readFile(metas[0],'utf8')); raw={...md.data,description:md.body}; }
        else raw=await json(metas[0]);
        if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('Metadata must be an object');
        if(raw.tags!==undefined) raw.tags=toList(raw.tags);
        if(raw.bpm==='') raw.bpm=null;
      }
      const tags=Object.fromEntries(Object.entries(info.format.tags||{}).map(([key,value])=>[key.toLowerCase(),value]));
      const meta=validateMeta({title:tags.title||path.parse(audio).name,artist:tags.artist||config.author||'Xenoah',album:tags.album||'',genre:tags.genre||'Other',license:config.defaultLicense,download:config.defaultDownload,...raw});
      const slug=raw.slug||`${slugify(meta.title)}-${hash(bytes).slice(0,8)}`;
      if(!validSlug(slug)) throw new Error('Invalid slug');
      const target=path.join(content,slug), archive=path.join(uploaded,slug);
      if(planned.has(slug)||await exists(target)||await exists(archive)) throw new Error(`Slug already exists: ${slug}. Edit content/tracks/${slug}/ to update it.`);
      planned.add(slug);
      const covers=files.filter(f=>IMAGE.has(path.extname(f).toLowerCase()));
      if(covers.length>1) throw new Error('Use one cover image per track');
      if(covers[0]&&(await fs.stat(covers[0])).size>10*1024*1024) throw new Error('Cover exceeds 10 MiB');
      if(dryRun) { result.push(slug); console.log(`Would import: ${slug}`); continue; }
      const stage=path.join(temp,'normalized'); await fs.mkdir(stage);
      const filename='original'+path.extname(audio).toLowerCase(); await fs.copyFile(audio,path.join(stage,filename));
      let cover=null;
      if(covers[0]) { cover='cover'+path.extname(covers[0]).toLowerCase(); await fs.copyFile(covers[0],path.join(stage,cover)); }
      else if(extractCoverArt(audio,path.join(stage,'cover.jpg'))) cover='cover.jpg';
      await writeJSON(path.join(stage,'track.json'),{...meta,slug,audio:filename,cover});
      await fs.cp(stage,target,{recursive:true});
      const moved=[];
      try {
        if(entry.isDirectory()) { await fs.rename(source,archive); }
        else {
          await fs.mkdir(archive);
          for(const file of sources) { const to=path.join(archive,path.basename(file)); await fs.rename(file,to); moved.push([file,to]); }
        }
      } catch(error) {
        for(const [from,to] of moved.reverse()) await fs.rename(to,from);
        if(!entry.isDirectory()) await fs.rm(archive,{recursive:true,force:true});
        await fs.rm(target,{recursive:true,force:true}); throw error;
      }
      result.push(slug); console.log(`Imported: ${slug}`);
    } finally { await fs.rm(temp,{recursive:true,force:true}); }
  }
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), root=args.find(a=>!a.startsWith('--'))||'.';
  for(const arg of args.filter(a=>a.startsWith('--'))) if(!['--dry-run','--apply'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
  await importInbox(path.resolve(root),{dryRun:args.includes('--dry-run')});
}
