import {WaveView,ScopeView} from './vendor/dtcue/views.js';
import {zipFiles} from './zip.js';
const $=s=>document.querySelector(s),audio=$('#audio');
const time=s=>{s=Number.isFinite(s)?s:0;return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;};
let catalog=[],filtered=[],selected=null,favoritesOnly=false,selection=0,analysisAbort=null,localURL=null,worker=null,frame=0,toastTimer,volumeBeforeMute=.75;
let favorites;try{favorites=new Set(JSON.parse(localStorage.getItem('archive-music:favorites')||'[]'));}catch{favorites=new Set();}
const engine={analysis:null,a:-1,b:-1,loop:false,isVideo:false,file:null,buffer:null,ctx:null,
  get duration(){return Number.isFinite(audio.duration)?audio.duration:selected?.duration||0;},
  get currentTime(){return Number.isFinite(audio.currentTime)?audio.currentTime:0;},get playing(){return !audio.paused&&!audio.ended;},
  seek(t){if(!Number.isFinite(audio.duration))return;audio.currentTime=Math.max(0,Math.min(audio.duration,t));draw();}
};
const wave=new WaveView($('#wave'),$('#overview'),engine),osc=new ScopeView($('#osc'),engine,$('#monitor')),fft=new ScopeView($('#fft'),engine,$('#monitor'));fft.mode='fft';
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
function setStatus(message){$('#analysis-status').textContent=message;}
function setupAudio(){
  if(engine.ctx)return engine.ctx.resume();
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('このブラウザはWeb Audioに対応していません');
  engine.ctx=new AC();engine.gain=engine.ctx.createGain();engine.gain.gain.value=Number($('#volume').value);
  engine.analyser=engine.ctx.createAnalyser();engine.analyser.fftSize=4096;engine.analyser.smoothingTimeConstant=.75;
  engine.left=engine.ctx.createAnalyser();engine.right=engine.ctx.createAnalyser();engine.left.fftSize=engine.right.fftSize=4096;
  const splitter=engine.ctx.createChannelSplitter(2);engine.gain.connect(engine.analyser);engine.analyser.connect(engine.ctx.destination);engine.gain.connect(splitter);splitter.connect(engine.left,0);splitter.connect(engine.right,1);
  const source=engine.ctx.createMediaElementSource(audio);source.connect(engine.gain);return engine.ctx.resume();
}
async function togglePlay(){try{if(!selected)return;if(engine.playing)audio.pause();else{await setupAudio();await audio.play();}}catch(e){toast(`再生できません: ${e.message}`);}}
function syncPlayback(){
  const playing=engine.playing;$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'一時停止':'再生');$('#hero-play').textContent=playing?'Ⅱ 一時停止':'▶ 再生する';$('#hero-play').setAttribute('aria-label',playing?'一時停止':'再生');$('#play-dot').classList.toggle('playing',playing);$('#play-status').textContent=playing?'NOW PLAYING':'READY TO LISTEN';
  document.querySelectorAll('.row-num').forEach(b=>{b.textContent=b.dataset.slug===selected?.slug?(playing?'Ⅱ':'▶'):b.dataset.number;b.setAttribute('aria-label',`${b.dataset.slug===selected?.slug&&playing?'一時停止':'再生'} ${b.dataset.title}`);});
  draw();if(playing&&!frame)frame=requestAnimationFrame(tick);
}
function draw(){wave.follow();wave.draw();osc.draw();fft.draw();$('#elapsed').textContent=time(engine.currentTime);$('#duration').textContent=time(engine.duration);$('#seek').value=engine.duration?engine.currentTime/engine.duration*1000:0;$('#seek').setAttribute('aria-valuetext',`${time(engine.currentTime)} / ${time(engine.duration)}`);}
let lastFrame=0;
function tick(t){frame=0;if(!document.hidden&&t-lastFrame>1000/30){draw();lastFrame=t;}if(engine.playing)frame=requestAnimationFrame(tick);}
function applyBPM(bpm,offset=0,kind='試聴補正'){
  wave.bpm=Number(bpm)||0;wave.beatOffset=offset;$('#current-bpm').textContent=bpm??'—';$('#tempo-value').textContent=bpm??'—';$('#bpm-type').textContent=kind;wave.draw();
}
function showAnalysis(a){
  engine.analysis=a;applyBPM(selected.bpm??a.bpm,selected.bpmSource==='manual'?0:a.beatOffset,selected.bpmSource==='manual'?'指定':'推定');
  const wrap=$('#tempo-engines');wrap.replaceChildren();
  for(const e of a.engines||[]){const row=document.createElement('div');row.className='engine-line';const label=document.createElement('span');label.textContent=e.short;const meter=document.createElement('span');meter.className='meter';const bar=document.createElement('i');bar.style.width=`${(e.candidates[0]?.confidence||0)*100}%`;meter.append(bar);const value=document.createElement('b');value.textContent=e.candidates[0]?.bpm??'—';row.title=e.label+(e.reason?': '+e.reason:'');row.append(label,meter,value);wrap.append(row);}
  const candidates=$('#tempo-candidates');candidates.replaceChildren();
  for(const c of a.tempoCandidates||[]){const b=document.createElement('button');b.textContent=`${c.bpm} · ${c.support}/3`;b.type='button';b.addEventListener('click',()=>applyBPM(c.bpm,c.beatOffset));candidates.append(b);}
  setStatus(a.reason||'低域（橙）・中域（青）・高域（紫）。BPMは推定値です。オシロ・FFTは再生中に動きます。');wave.draw();
}
function renderSelected(){
  if(!selected)return;const t=selected;
  for(const id of ['current-title','mini-title'])$('#'+id).textContent=t.title;
  for(const id of ['current-artist','mini-artist'])$('#'+id).textContent=t.artist;
  for(const id of ['current-cover','mini-cover'])$('#'+id).src=t.cover;
  $('#current-description').textContent=t.description||'このトラックの説明はまだありません。';$('#current-license').textContent=t.license;
  $('#current-format').textContent=t.sampleRate?`${(t.sampleRate/1000).toFixed(1)} kHz · ${t.channels===1?'MONO':'STEREO'}`:'LOCAL PREVIEW';
  const tags=$('#current-tags');tags.replaceChildren();for(const s of [t.genre,...(t.demo?['DEMO']:[]),...(t.local?['LOCAL / 未投稿']:[])]){const el=document.createElement('span');el.className='badge'+(t.demo?' demo':'');el.textContent=s;tags.append(el);}
  const dl=$('#download');dl.hidden=!t.original;if(t.original){dl.href=t.original;dl.download=t.title+new URL(t.original,location.href).pathname.match(/\.[^.]+$/)?.[0];}else dl.removeAttribute('href');
  $('#share').disabled=!!t.local;$('#current-fav').disabled=!!t.local;$('#current-fav').textContent=favorites.has(t.slug)?'♥':'♡';$('#current-fav').setAttribute('aria-pressed',String(favorites.has(t.slug)));$('#current-fav').setAttribute('aria-label',favorites.has(t.slug)?'お気に入りから削除':'お気に入りに追加');
  $('#tempo-engines').replaceChildren();$('#tempo-candidates').replaceChildren();$('#manual-bpm').value='';applyBPM(t.bpm,0,t.bpmSource==='manual'?'指定':'推定');
}
async function selectTrack(track,play=false){
  const current=++selection;analysisAbort?.abort();worker?.terminate();worker=null;audio.pause();selected=track;engine.analysis=null;engine.buffer=null;wave.reset();$('#wave-zoom').value='1';
  renderSelected();renderList();audio.src=track.audio;audio.load();syncPlayback();
  if(!track.local)history.replaceState(null,'',`#track=${encodeURIComponent(track.slug)}`);
  if(play)try{await setupAudio();if(current===selection)await audio.play();}catch(e){if(current===selection)toast(`再生できません: ${e.message}`);}
  if(current!==selection)return;
  if(track.analysis){analysisAbort=new AbortController();setStatus('波形を読み込んでいます…');try{const res=await fetch(track.analysis,{signal:analysisAbort.signal});if(!res.ok)throw new Error(String(res.status));const a=await res.json();if(current===selection)showAnalysis(a);}catch(e){if(e.name!=='AbortError'&&current===selection)setStatus('波形データを読み込めませんでした。音声の再生は操作できます。');}}
}
function filteredTracks(){
  const query=$('#search').value.trim().toLowerCase(),genre=$('#genre').value,range=$('#bpm-filter').value;
  return catalog.filter(t=>(!favoritesOnly||favorites.has(t.slug))&&(!genre||t.genre===genre)&&(!query||[t.title,t.artist,t.album,...t.tags].join(' ').toLowerCase().includes(query))&&(!range||t.bpm!=null&&(range==='slow'?t.bpm<100:range==='medium'?t.bpm>=100&&t.bpm<140:t.bpm>=140))).sort((a,b)=>$('#sort').value==='title'?a.title.localeCompare(b.title):$('#sort').value==='bpm'?(a.bpm??Infinity)-(b.bpm??Infinity):$('#sort').value==='duration'?a.duration-b.duration:b.createdAt.localeCompare(a.createdAt)||a.title.localeCompare(b.title));
}
function miniWave(peaks){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 200 34');svg.setAttribute('aria-hidden','true');svg.classList.add('row-wave');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',peaks.map((v,i)=>{const h=Math.max(1,Math.pow(v,.65)*14);return `M${i*2},${17-h}v${h*2}`;}).join(''));path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1');svg.append(path);return svg;
}
function renderList(){
  filtered=filteredTracks();const list=$('#track-list');list.replaceChildren();$('#track-count').textContent=String(filtered.length).padStart(2,'0');$('#all-count').textContent=catalog.length;$('#fav-count').textContent=catalog.filter(t=>favorites.has(t.slug)).length;$('#empty').hidden=!!filtered.length;
  for(const [i,t] of filtered.entries()){
    const row=document.createElement('div');row.className='track-row'+(selected?.slug===t.slug?' active':'');
    const play=document.createElement('button');play.className='row-num';Object.assign(play.dataset,{slug:t.slug,number:String(i+1).padStart(2,'0'),title:t.title});play.textContent=selected?.slug===t.slug?(engine.playing?'Ⅱ':'▶'):play.dataset.number;play.setAttribute('aria-label',`再生 ${t.title}`);
    const name=document.createElement('button');name.className='row-track';name.setAttribute('aria-label',`${t.title} を再生`);const img=document.createElement('img');img.src=t.cover;img.alt='';img.loading='lazy';const text=document.createElement('span'),title=document.createElement('span'),artist=document.createElement('span');title.className='row-title';title.textContent=t.title;artist.className='row-artist';artist.textContent=`${t.artist} · ${t.genre}`;text.append(title,artist);name.append(img,text);
    const start=()=>selected?.slug===t.slug?togglePlay():selectTrack(t,true);play.addEventListener('click',start);name.addEventListener('click',start);
    const bpm=document.createElement('span');bpm.className='row-bpm';bpm.textContent=t.bpm??'—';const duration=document.createElement('span');duration.className='row-time';duration.textContent=time(t.duration);
    const fav=document.createElement('button');fav.className='row-fav';fav.textContent=favorites.has(t.slug)?'♥':'♡';fav.setAttribute('aria-label',`${t.title} のお気に入りを切り替え`);fav.setAttribute('aria-pressed',String(favorites.has(t.slug)));fav.addEventListener('click',()=>toggleFavorite(t.slug));
    row.append(play,name,miniWave(t.peaks),bpm,duration,fav);list.append(row);
  }
}
function toggleFavorite(slug){if(favorites.has(slug))favorites.delete(slug);else favorites.add(slug);try{localStorage.setItem('archive-music:favorites',JSON.stringify([...favorites]));}catch{toast('お気に入りを保存できません。このセッションのみ有効です。');}renderList();if(selected){$('#current-fav').textContent=favorites.has(selected.slug)?'♥':'♡';$('#current-fav').setAttribute('aria-pressed',String(favorites.has(selected.slug)));$('#current-fav').setAttribute('aria-label',favorites.has(selected.slug)?'お気に入りから削除':'お気に入りに追加');}}
function navigate(direction){const list=filtered.length?filtered:catalog;if(!list.length)return;const i=list.findIndex(t=>t.slug===selected?.slug);selectTrack(list[(i+direction+list.length)%list.length],true);}
for(const id of ['play','hero-play'])$('#'+id).addEventListener('click',togglePlay);
for(const event of ['play','pause','ended','loadedmetadata','seeked'])audio.addEventListener(event,syncPlayback);
audio.addEventListener('timeupdate',()=>{if(!engine.playing)draw();});
audio.addEventListener('error',()=>{if(audio.src)toast('音源を読み込めませんでした。公開ファイルと対応形式を確認してください。');});
audio.addEventListener('ended',()=>{if(!audio.loop)navigate(1);});
$('#prev').addEventListener('click',()=>navigate(-1));$('#next').addEventListener('click',()=>navigate(1));
$('#repeat').addEventListener('click',()=>{audio.loop=!audio.loop;$('#repeat').setAttribute('aria-pressed',String(audio.loop));});
$('#seek').addEventListener('input',e=>engine.seek(Number(e.target.value)/1000*engine.duration));
$('#volume').addEventListener('input',()=>{const volume=Number($('#volume').value);if(engine.gain)engine.gain.gain.value=volume;$('#volume-value').textContent=Math.round(volume*100)+'%';$('#mute').setAttribute('aria-pressed',String(volume===0));});
$('#mute').addEventListener('click',()=>{const v=Number($('#volume').value);if(v){volumeBeforeMute=v;$('#volume').value='0';}else $('#volume').value=String(volumeBeforeMute||.75);$('#volume').dispatchEvent(new Event('input'));});
$('#current-fav').addEventListener('click',()=>{if(selected&&!selected.local)toggleFavorite(selected.slug);});
$('#share').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('曲へのリンクをコピーしました');}catch{toast('アドレスバーのURLをコピーしてください');}});
$('#wave-zoom').addEventListener('change',e=>wave.setZoom(Number(e.target.value)));$('#wave').addEventListener('zoomchange',()=>{$('#wave-zoom').value=String(wave.zoom);});
$('#beat-grid').addEventListener('change',e=>{wave.grid=e.target.checked;wave.draw();});$('#scope-window').addEventListener('change',e=>{osc.window=Number(e.target.value);osc.draw();});
$('#apply-bpm').addEventListener('click',()=>{const bpm=Number($('#manual-bpm').value);if(bpm>=40&&bpm<=240)applyBPM(bpm);else toast('BPMは40〜240で入力してください');});
$('#reset-bpm').addEventListener('click',()=>{if(engine.analysis)showAnalysis(engine.analysis);});
for(const id of ['search','genre','bpm-filter','sort'])$('#'+id).addEventListener(id==='search'?'input':'change',renderList);
function setLibrary(fav){favoritesOnly=fav;$('#all-nav').classList.toggle('selected',!fav);$('#fav-nav').classList.toggle('selected',fav);$('#library-title').firstChild.textContent=fav?'お気に入り ':'すべてのトラック ';renderList();}
$('#all-nav').addEventListener('click',()=>setLibrary(false));$('#fav-nav').addEventListener('click',()=>{setLibrary(true);$('#library').scrollIntoView({behavior:'smooth'});});
$('#reset-filters').addEventListener('click',()=>{for(const id of ['search','genre','bpm-filter'])$('#'+id).value='';setLibrary(false);});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)&&!$('#upload-dialog').open){e.preventDefault();togglePlay();}});
window.addEventListener('resize',draw);window.addEventListener('hashchange',()=>{const slug=new URLSearchParams(location.hash.slice(1)).get('track'),t=catalog.find(t=>t.slug===slug);if(t&&t.slug!==selected?.slug)selectTrack(t);});

// Local listening never uploads a file. Analysis runs in a disposable worker.
$('#local-button').addEventListener('click',()=>$('#local-file').click());
$('#local-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;worker?.terminate();if(localURL)URL.revokeObjectURL(localURL);localURL=URL.createObjectURL(file);
  await selectTrack({slug:'local',title:file.name.replace(/\.[^.]+$/,''),artist:'この端末だけの試聴',genre:'Local',description:'このファイルはアップロードされません。投稿する場合は「音楽を投稿する」へ。',license:'LOCAL PREVIEW',cover:'assets/favicon.svg',audio:localURL,duration:0,bpm:null,tags:[],local:true},false);const current=selection;
  if(file.size>40*1024*1024){setStatus('40 MiBを超えるローカル音源は波形・BPMの全解析を省略します。再生とオシロ・FFTは利用できます。');return;}
  try{
    await setupAudio();const data=await file.arrayBuffer();if(current!==selection)return;
    const buffer=await engine.ctx.decodeAudioData(data);if(current!==selection)return;
    if(buffer.duration>600){setStatus('10分を超えるローカル音源は全解析を省略します。再生とオシロ・FFTは利用できます。');return;}
    engine.buffer=buffer;selected.sampleRate=buffer.sampleRate;selected.channels=buffer.numberOfChannels;$('#current-format').textContent=`${(buffer.sampleRate/1000).toFixed(1)} kHz · ${buffer.numberOfChannels} CH`;
    const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());worker=new Worker(new URL('./vendor/dtcue/analysis-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{if(current!==selection)return;if(data.result){selected.bpm=data.result.bpm;showAnalysis(data.result);worker?.terminate();worker=null;}else if(data.error){setStatus(`解析できません: ${data.error}`);worker?.terminate();worker=null;}else setStatus(`ローカル音源を解析中 ${Math.round(data.progress*100)}%`);};
    worker.onerror=()=>{if(current===selection)setStatus('解析を完了できませんでした。再生は操作できます。');worker?.terminate();worker=null;};worker.postMessage({channels,sampleRate:buffer.sampleRate},channels.map(c=>c.buffer));
  }catch(err){if(current===selection)setStatus(`この音源を解析できません: ${err.message}`);}
});

const dialog=$('#upload-dialog'),form=$('#upload-form');let droppedAudio=null;
document.querySelectorAll('[data-upload]').forEach(b=>b.addEventListener('click',()=>dialog.showModal()));$('[data-close]').addEventListener('click',()=>dialog.close());
function showFile(f){if(!f)return;$('#upload-file-label').textContent=f.name;if(!form.elements.title.value)form.elements.title.value=f.name.replace(/\.[^.]+$/,'');}
$('#upload-audio').addEventListener('change',e=>{droppedAudio=null;showFile(e.target.files[0]);});
for(const type of ['dragover','dragleave','drop'])$('#dropzone').addEventListener(type,e=>{e.preventDefault();$('#dropzone').classList.toggle('dragover',type==='dragover');if(type==='drop'){const f=e.dataTransfer.files[0];if(f){droppedAudio=f;$('#upload-audio').required=false;showFile(f);}}});
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
form.addEventListener('submit',async e=>{
  e.preventDefault();const button=$('#package-button'),status=$('#upload-status');status.textContent='';
  try{
    const file=droppedAudio||$('#upload-audio').files[0],cover=$('#upload-cover').files[0],ext=file?.name.split('.').pop().toLowerCase();
    if(!file||!['mp3','wav','flac','m4a','ogg','aac','opus'].includes(ext))throw new Error('対応する音声ファイルを選択してください');
    if(file.size+(cover?.size||0)>24*1024*1024)throw new Error('GitHubのブラウザ投稿用に、音源と画像の合計を24 MiB以下にしてください。大きい音源はGitで _inbox に追加できます');
    if(cover&&(!/\.(png|jpe?g|webp)$/i.test(cover.name)||cover.size>8*1024*1024))throw new Error('ジャケットはPNG/JPG/WebP、8 MiB以下を指定してください');
    button.disabled=true;button.textContent='パッケージを作成中…';const data=new FormData(form),title=String(data.get('title')).trim(),artist=String(data.get('artist')).trim();if(!title||!artist)throw new Error('曲名とアーティストを入力してください');
    const tags=String(data.get('tags')).split(/[,、]/).map(s=>s.trim()).filter(Boolean);if(tags.length>12||tags.some(s=>s.length>40))throw new Error('タグは12個まで、各40文字以内です');
    const base=title.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'track';
    const slug=base+'-'+crypto.randomUUID().slice(0,8),meta={slug,title,artist,genre:String(data.get('genre')).trim()||'Other',tags,description:String(data.get('description')),license:String(data.get('license')),status:String(data.get('status')),download:data.get('download')==='on',createdAt:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}),bpm:data.get('bpm')?Number(data.get('bpm')):null};
    const entries=[{name:`${slug}/track.json`,data:JSON.stringify(meta,null,2)},{name:`${slug}/audio.${ext}`,data:new Uint8Array(await file.arrayBuffer())}];
    if(cover)entries.push({name:`${slug}/cover.${cover.name.split('.').pop().toLowerCase()}`,data:new Uint8Array(await cover.arrayBuffer())});
    saveBlob(zipFiles(entries),slug+'.zip');status.textContent='ZIPを保存しました。下のリンク先にZIPを追加して「Commit changes」を押してください。Actionsが成功すると公開されます。';
  }catch(err){status.textContent=err.message;}finally{button.disabled=false;button.textContent='投稿用ZIPを作成 ↓';}
});

try{
  const response=await fetch('catalog.json');if(!response.ok)throw new Error('catalog.json not found');const data=await response.json();catalog=data.tracks;
  const repository=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.repository)?data.repository:'Xenoah/archive_music';$('#repo-link').href=`https://github.com/${repository}`;$('#upload-link').href=`https://github.com/${repository}/upload/main/_inbox`;
  for(const name of [...new Set(catalog.map(t=>t.genre))].sort()){const option=document.createElement('option');option.value=name;option.textContent=name;$('#genre').append(option);}
  $('#demo-note').hidden=!catalog.some(t=>t.demo);renderList();const slug=new URLSearchParams(location.hash.slice(1)).get('track');const first=catalog.find(t=>t.slug===slug)||catalog.find(t=>!t.demo)||catalog.find(t=>t.slug==='midnight-circuit')||catalog[0];
  if(first)await selectTrack(first,false);else{$('#current-title').textContent='最初の音を、ここに。';$('#current-artist').textContent='音楽を投稿してアーカイブを始めましょう';setStatus('まだ曲がありません。');}
}catch(err){$('#current-title').textContent='アーカイブを読み込めません';setStatus('公開データの読み込みに失敗しました。ページを再読み込みしてください。');console.error(err);}
draw();
