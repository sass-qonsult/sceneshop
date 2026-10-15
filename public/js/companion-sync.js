(function(root){
  'use strict';
  const fp=root.SceneShopSyncFingerprint;
  function concat(chunks){let n=0;for(const c of chunks)n+=c.length;const out=new Float32Array(n);let o=0;for(const c of chunks){out.set(c,o);o+=c.length;}return out;}
  async function capture(seconds=5){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Microfone não disponível neste navegador.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    const Ctx=root.AudioContext||root.webkitAudioContext; if(!Ctx){stream.getTracks().forEach(t=>t.stop());throw new Error('Web Audio API não disponível.');}
    const ctx=new Ctx(); const src=ctx.createMediaStreamSource(stream); const proc=ctx.createScriptProcessor(4096,1,1); const sink=ctx.createGain(); sink.gain.value=0;
    const chunks=[]; proc.onaudioprocess=e=>chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc);proc.connect(sink);sink.connect(ctx.destination);
    await new Promise(r=>setTimeout(r,Math.max(2,Math.min(10,Number(seconds)||5))*1000));
    proc.disconnect();src.disconnect();sink.disconnect();stream.getTracks().forEach(t=>t.stop());const rate=ctx.sampleRate;await ctx.close();
    return{samples:concat(chunks),sampleRate:rate};
  }
  async function requestSync(path,{externalUrl=null,seconds=5,workId=null}={}){
    if(!fp)throw new Error('Motor de fingerprint não carregado.');
    const audio=await capture(seconds); const windows=fp.fingerprint(audio.samples,audio.sampleRate);
    if(windows.length<2)throw new Error('Amostra curta ou silenciosa demais para sincronizar.');
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({externalUrl:externalUrl||null,workId:workId||null,samples:windows.map(x=>({hash:x.hash,offset:x.offset}))})});
    const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(data.error==='SYNC_NOT_RECOGNIZED'?'Conteúdo não reconhecido. Aproxime o aparelho da fonte de áudio e tente novamente.':(data.error||'Falha ao sincronizar.'));
    return data;
  }
  const recognize=(opts={})=>requestSync('/api/sync/recognize',opts);
  const synchronize=(opts={})=>requestSync('/api/sync/start',opts);
  root.SceneShopCompanionSync={capture,recognize,synchronize};
})(typeof globalThis!=='undefined'?globalThis:this);
