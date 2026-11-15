import fs from 'node:fs/promises';
import path from 'node:path';
import {makeDemo} from './dtcue-demo.js';
import {run,writeJSON,exists} from './lib.mjs';
export async function generateDemo(root){
  const folder=path.join(root,'.cache/demo');await fs.mkdir(folder,{recursive:true});
  const source=path.join(folder,'original.wav');if(!await exists(source))await fs.writeFile(source,new Uint8Array(await makeDemo().arrayBuffer()));
  const demos=[['midnight-circuit','Midnight Circuit',128,'Electronic',1],['slow-orbit','Slow Orbit',96,'Downtempo',.75],['afterimage','Afterimage',160,'Breakbeat',1.25]];
  for(const [slug,title,bpm,genre,speed] of demos){
    const dir=path.join(root,'content/tracks',slug);if(await exists(dir))continue;await fs.mkdir(dir,{recursive:true});
    run('ffmpeg',['-v','error','-i',source,'-af',`asetrate=${48000*speed},aresample=44100`,'-codec:a','libmp3lame','-b:a','160k',path.join(dir,'original.mp3')]);
    await writeJSON(path.join(dir,'track.json'),{slug,title,artist:'Archive Music / Demo',genre,tags:['demo','synthesized'],description:'動作確認用の合成デモ音源。dt-cue のドラム・ベース生成コードから作成しています。実際の投稿作品ではありません。',license:'MIT (dt-cue demo)',status:'public',download:true,createdAt:'2026-11-15',demo:true,audio:'original.mp3',cover:null});
  }
}
if(process.argv[1]?.endsWith('generate-demo.mjs'))await generateDemo(path.resolve('.'));
