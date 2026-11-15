import fs from 'node:fs/promises';
import path from 'node:path';
import {analyzePCM} from '../site/src/vendor/dtcue/analysis-core.js';
import {AUDIO,IMAGE,MAX_BYTES,json,writeJSON,exists,filesIn,run,probe,validateMeta,validSlug,escape,hash} from './lib.mjs';
import {generateDemo} from './generate-demo.mjs';
const root=path.resolve(process.argv[2]||'.'),dist=path.join(root,'dist');
if(process.env.INCLUDE_DEMOS!=='false')await generateDemo(root);
await fs.rm(dist,{recursive:true,force:true});await fs.cp(path.join(root,'site'),dist,{recursive:true});
await fs.mkdir(path.join(root,'.cache/analysis'),{recursive:true});
const tracks=[];
const coverSVG=(title,seed)=>{
  const hue=parseInt(seed.slice(0,4),16)%360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue},50%,18%)"/><stop offset="1" stop-color="hsl(${(hue+45)%360},65%,48%)"/></linearGradient><radialGradient id="r"><stop stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="590" cy="130" r="480" fill="url(#r)"/>${Array.from({length:18},(_,i)=>`<ellipse cx="400" cy="390" rx="${80+i*17}" ry="${55+i*14}" transform="rotate(${i*4-40} 400 390)" stroke="${i%3?'#eaf6da':'#d4f277'}" stroke-opacity="${.12+i*.02}" fill="none" stroke-width="2"/>`).join('')}<text x="54" y="72" fill="#fff" opacity=".7" font-family="sans-serif" font-size="17" letter-spacing="5">ARCHIVE / MUSIC</text><text x="54" y="713" fill="#fff" font-family="sans-serif" font-size="34">${escape(title.slice(0,28))}</text></svg>`;
};
for(const entry of (await fs.readdir(path.join(root,'content/tracks'),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
  const dir=path.join(root,'content/tracks',entry.name);await filesIn(dir);
  const raw=await json(path.join(dir,'track.json')),m=validateMeta(raw),slug=entry.name;
  if(!validSlug(slug)||raw.slug!==slug)throw new Error(`Invalid slug: ${slug}`);
  if(m.status==='draft'||(m.demo&&process.env.INCLUDE_DEMOS==='false'))continue;
  if(typeof raw.audio!=='string'||path.basename(raw.audio)!==raw.audio||!AUDIO.has(path.extname(raw.audio)))throw new Error(`Invalid audio: ${slug}`);
  const input=path.join(dir,raw.audio),bytes=await fs.readFile(input);if(bytes.length>MAX_BYTES)throw new Error('Audio exceeds 95 MiB');
  const info=probe(input),stream=info.streams.find(s=>s.codec_type==='audio'),duration=Number(info.format.duration);
  if(!stream||!Number.isFinite(duration)||duration<=0||duration>1200)throw new Error(`Invalid duration: ${slug}`);
  const out=path.join(dist,'music',slug);await fs.mkdir(out,{recursive:true});
  const key=hash(Buffer.concat([bytes,await fs.readFile(path.join(root,'site/src/vendor/dtcue/tempo.js')),await fs.readFile(path.join(root,'site/src/vendor/dtcue/analysis-core.js')),Buffer.from('24000-stereo-v1')]));
  const cached=path.join(root,'.cache/analysis',key+'.json');let analysis;
  if(await exists(cached))analysis=await json(cached);else{
    const pcm=run('ffmpeg',['-v','error','-i',input,'-map','0:a:0','-ac','2','-ar','24000','-f','f32le','pipe:1'],{binary:true});
    const length=pcm.length/8,l=new Float32Array(length),r=new Float32Array(length);for(let i=0;i<length;i++){l[i]=pcm.readFloatLE(i*8);r[i]=pcm.readFloatLE(i*8+4);}
    analysis=analyzePCM([l,r],24000);for(const k of ['low','mid','high','peak'])analysis[k]=Array.from(analysis[k],v=>Math.round(v*10000)/10000);
    await writeJSON(cached,analysis);
  }
  run('ffmpeg',['-v','error','-i',input,'-map','0:a:0','-vn','-ar','44100','-ac','2','-codec:a','libmp3lame','-b:a','192k','-map_metadata','-1',path.join(out,'stream.mp3')]);
  await writeJSON(path.join(out,'analysis.json'),analysis);
  if(raw.cover){
    if(path.basename(raw.cover)!==raw.cover||!IMAGE.has(path.extname(raw.cover).toLowerCase()))throw new Error('Invalid cover');
    run('ffmpeg',['-v','error','-i',path.join(dir,raw.cover),'-vf','scale=800:800:force_original_aspect_ratio=increase,crop=800:800','-frames:v','1',path.join(out,'cover.jpg')]);
  }else await fs.writeFile(path.join(out,'cover.svg'),coverSVG(m.title,key));
  if(m.download)await fs.copyFile(input,path.join(out,raw.audio));
  const track={...m,slug,duration:analysis.duration,bpm:m.bpm??analysis.bpm,bpmSource:m.bpm?'manual':'estimated',confidence:analysis.confidence,sampleRate:Number(stream.sample_rate),channels:stream.channels,bytes:bytes.length,audio:`music/${slug}/stream.mp3`,analysis:`music/${slug}/analysis.json`,cover:`music/${slug}/cover.${raw.cover?'jpg':'svg'}`,original:m.download?`music/${slug}/${raw.audio}`:null,peaks:Array.from({length:100},(_,i)=>{const a=Math.floor(i/100*analysis.peak.length),b=Math.max(a+1,Math.floor((i+1)/100*analysis.peak.length));return Math.max(...analysis.peak.slice(a,b));})};
  tracks.push(track);console.log(`Built ${slug}: ${analysis.bpm??'unknown'} BPM`);
}
await writeJSON(path.join(dist,'catalog.json'),{title:'ARCHIVE MUSIC',repository:process.env.GITHUB_REPOSITORY||'Xenoah/archive_music',tracks:tracks.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.title.localeCompare(b.title)),generatedAt:new Date().toISOString()});
await fs.writeFile(path.join(dist,'.nojekyll'),'');
await fs.copyFile(path.join(root,'site/src/vendor/dtcue/LICENSE'),path.join(dist,'DTCUE-LICENSE.txt'));
console.log(`Built ${tracks.length} tracks → dist/`);
