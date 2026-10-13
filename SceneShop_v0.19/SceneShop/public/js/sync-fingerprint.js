/* SceneShop Temporal Audio Fingerprint v1
 * Shared by the browser/mobile companion and the server-side index builder.
 * It intentionally emits compact perceptual descriptors, not source audio.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.SceneShopSyncFingerprint=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TARGET_RATE=8000;
  const FREQS=[260,390,560,780,1050,1400,1850,2400,3050,3600];
  const FRAME=400;   // 50 ms @ 8 kHz
  const HOP=200;     // 25 ms
  const CHUNK_FRAMES=20; // 500 ms descriptors; compact enough for feature-length manifests

  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function downsample(input,rate){
    if(!input||!input.length) return new Float32Array(0);
    rate=Number(rate)||TARGET_RATE;
    if(rate===TARGET_RATE) return Float32Array.from(input);
    const n=Math.max(1,Math.floor(input.length*TARGET_RATE/rate));
    const out=new Float32Array(n);
    const ratio=rate/TARGET_RATE;
    for(let i=0;i<n;i++){
      const start=i*ratio,end=(i+1)*ratio;
      const a=Math.floor(start),b=Math.min(input.length-1,Math.ceil(end));
      let sum=0,w=0;
      for(let j=a;j<=b;j++){
        const left=Math.max(start,j),right=Math.min(end,j+1),ww=Math.max(0,right-left);
        if(ww){sum+=Number(input[j]||0)*ww;w+=ww;}
      }
      out[i]=w?sum/w:Number(input[Math.min(input.length-1,a)]||0);
    }
    return out;
  }
  function goertzel(samples,start,freq){
    const omega=2*Math.PI*freq/TARGET_RATE;
    const coeff=2*Math.cos(omega); let s0=0,s1=0,s2=0;
    for(let i=0;i<FRAME;i++){
      const x=Number(samples[start+i]||0);
      const win=0.5-0.5*Math.cos(2*Math.PI*i/(FRAME-1));
      s0=x*win+coeff*s1-s2; s2=s1; s1=s0;
    }
    return Math.max(1e-12,s1*s1+s2*s2-coeff*s1*s2);
  }
  function bands(samples,start){
    const vals=FREQS.map(f=>Math.log1p(goertzel(samples,start,f)));
    const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    return vals.map(v=>v-mean);
  }
  function bitsToHex(bits){
    let value=0n; for(const bit of bits)value=(value<<1n)|BigInt(bit?1:0);
    return value.toString(16).padStart(Math.ceil(bits.length/4),'0');
  }
  function descriptor(prev,curr){
    const bits=[];
    // Temporal movement of every band.
    for(let i=0;i<curr.length;i++) bits.push(curr[i]>=prev[i]);
    // Spectral shape inside the current window.
    for(let i=0;i<curr.length-1;i++) bits.push(curr[i]>=curr[i+1]);
    // Coarse energy contrasts improve stability while keeping a compact hash.
    bits.push((curr[0]+curr[1]+curr[2]) >= (curr[3]+curr[4]+curr[5]));
    bits.push((curr[4]+curr[5]+curr[6]) >= (curr[7]+curr[8]+curr[9]));
    return bitsToHex(bits); // 21 perceptual bits => 6 hex chars
  }
  function averageFrames(frames,a,b){
    const out=new Array(FREQS.length).fill(0); const n=Math.max(1,b-a);
    for(let i=a;i<b;i++) for(let k=0;k<out.length;k++) out[k]+=frames[i][k]/n;
    return out;
  }
  function fingerprint(samples,sampleRate,{startSeconds=0}={}){
    const pcm=downsample(samples,sampleRate);
    if(pcm.length<FRAME+HOP*CHUNK_FRAMES*2) return [];
    const frames=[];
    for(let p=0;p+FRAME<=pcm.length;p+=HOP) frames.push(bands(pcm,p));
    const out=[];
    for(let i=CHUNK_FRAMES;i+CHUNK_FRAMES<=frames.length;i+=CHUNK_FRAMES){
      const prev=averageFrames(frames,i-CHUNK_FRAMES,i);
      const curr=averageFrames(frames,i,i+CHUNK_FRAMES);
      const offset=(i*HOP)/TARGET_RATE;
      const energy=curr.reduce((s,v)=>s+Math.abs(v),0)/curr.length;
      out.push({
        hash:descriptor(prev,curr),
        offset:Number((startSeconds+offset).toFixed(3)),
        quality:Number(clamp(energy/2,0,1).toFixed(6)),
        algorithm:'SS-AUDIO-SPECTRAL',version:1,
      });
    }
    return out;
  }
  function hammingHex(a,b){
    try{let x=BigInt('0x'+a)^BigInt('0x'+b),n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}catch{return 999;}
  }
  return {TARGET_RATE,FREQS,FRAME,HOP,CHUNK_FRAMES,downsample,fingerprint,hammingHex};
});
