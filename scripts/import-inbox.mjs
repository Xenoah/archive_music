import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {AUDIO,IMAGE,MAX_BYTES,exists,filesIn,hash,slugify,validSlug,json,writeJSON,validateMeta,probe,unpackZIP} from './lib.mjs';

export async function importInbox(root){
  const inbox=path.join(root,'_inbox'),content=path.join(root,'content/tracks'),uploaded=path.join(root,'_uploaded');
  await fs.mkdir(inbox,{recursive:true});await fs.mkdir(content,{recursive:true});await fs.mkdir(uploaded,{recursive:true});
  const result=[];
  for(const entry of (await fs.readdir(inbox,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.'))continue;
    const source=path.join(inbox,entry.name),temp=await fs.mkdtemp(path.join(os.tmpdir(),'music-import-'));
    try{
      if(entry.isSymbolicLink())throw new Error('Symbolic links are not accepted');
      let files;
      if(entry.isDirectory())files=await filesIn(source);
      else if(path.extname(entry.name).toLowerCase()==='.zip'){await unpackZIP(await fs.readFile(source),temp);files=await filesIn(temp);}
      else if(AUDIO.has(path.extname(entry.name).toLowerCase()))files=[source];
      else throw new Error(`Unsupported inbox file: ${entry.name}`);
      const audios=files.filter(f=>AUDIO.has(path.extname(f).toLowerCase()));
      if(audios.length!==1)throw new Error('One audio file per track is required');
      const audio=audios[0],bytes=await fs.readFile(audio);if(bytes.length>MAX_BYTES)throw new Error('Audio exceeds 95 MiB');
      const info=probe(audio),duration=Number(info.format.duration);
      if(!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>1200)throw new Error('Audio must be at most 20 minutes');
      const metas=files.filter(f=>path.basename(f)==='track.json');if(metas.length>1)throw new Error('Duplicate track.json');
      const tags=info.format.tags||{},raw=metas[0]?await json(metas[0]):{};
      const meta=validateMeta({title:tags.title||path.parse(audio).name,artist:tags.artist||'Xenoah',album:tags.album||'',genre:tags.genre||'Other',...raw});
      const slug=raw.slug||`${slugify(meta.title)}-${hash(bytes).slice(0,8)}`;
      if(!validSlug(slug))throw new Error('Invalid slug');
      const target=path.join(content,slug),archive=path.join(uploaded,slug);
      if(await exists(target)||await exists(archive))throw new Error(`Slug already exists: ${slug}. Edit content/tracks/${slug}/ to update it.`);
      const stage=path.join(temp,'normalized');await fs.mkdir(stage);
      const filename='original'+path.extname(audio).toLowerCase();await fs.copyFile(audio,path.join(stage,filename));
      const covers=files.filter(f=>IMAGE.has(path.extname(f).toLowerCase()));if(covers.length>1)throw new Error('Use one cover image per track');
      let cover=null;if(covers[0]){cover='cover'+path.extname(covers[0]).toLowerCase();await fs.copyFile(covers[0],path.join(stage,cover));}
      await writeJSON(path.join(stage,'track.json'),{...meta,slug,audio:filename,cover});
      await fs.cp(stage,target,{recursive:true});
      try {if(entry.isDirectory())await fs.rename(source,archive);else{await fs.mkdir(archive);await fs.rename(source,path.join(archive,entry.name));}}
      catch(e){await fs.rm(target,{recursive:true,force:true});throw e;}
      result.push(slug);console.log(`Imported: ${slug}`);
    }finally{await fs.rm(temp,{recursive:true,force:true});}
  }
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await importInbox(path.resolve(process.argv[2]||'.'));
