import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateTempo,analyzePCM} from '../site/src/vendor/dtcue/analysis-core.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1,`Expected ${b}, got ${a}`);
test('original ensemble recovers slow, fast, and quiet rhythmic audio',()=>{
  for(const bpm of [40,80,96,128,160,210,240]){
    const env=new Float32Array(6000);
    for(let t=.2;t<30;t+=60/bpm)for(let k=0;k<10;k++)env[Math.round(t*200)+k]=Math.exp(-k/2)*.001;
    const result=estimateTempo(env,200);close(result.bpm,bpm);assert.equal(result.engines.length,3);
  }
});
test('silence, short clips and a single transient do not invent BPM',()=>{
  const transient=new Float32Array(6000);for(let i=0;i<100;i++)transient[i+500]=Math.exp(-i/10);
  for(const env of [new Float32Array(6000),new Float32Array(200),transient]){const r=estimateTempo(env,200);assert.equal(r.bpm,null);assert.ok(r.reason);}
});
test('opposite stereo phase preserves waveform and tempo energy',()=>{
  const sr=12000,bpm=120,l=Float32Array.from({length:sr*12},(_,i)=>Math.sin(i/sr*2*Math.PI*80)*Math.exp(-(i/sr%.5)*30));
  const result=analyzePCM([l,Float32Array.from(l,v=>-v)],sr);close(result.bpm,bpm);assert.ok(result.peak.some(v=>v>.5));assert.ok(result.low.some(v=>v>.01));
});
