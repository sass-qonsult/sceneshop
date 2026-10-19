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
    await new Promise(r=>setTimeout(r,Math.max(2,Math.min(12,Number(seconds)||5))*1000));
    proc.disconnect();src.disconnect();sink.disconnect();stream.getTracks().forEach(t=>t.stop());const rate=ctx.sampleRate;await ctx.close();
    return{samples:concat(chunks),sampleRate:rate};
  }
  /** WAV PCM 16-bit mono a 8 kHz: ~16 KB por segundo, formato aceito pela ACRCloud. */
  function encodeWav(samples,sampleRate){
    const rate=fp?fp.TARGET_RATE:8000; const pcm=fp?fp.downsample(samples,sampleRate):samples;
    const buf=new ArrayBuffer(44+pcm.length*2),v=new DataView(buf);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,pcm.length*2,true);
    for(let i=0;i<pcm.length;i++){const s=Math.max(-1,Math.min(1,Number(pcm[i])||0));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);}
    return new Uint8Array(buf);
  }
  let providerPromise=null;
  /** "sceneshop" (SceneShop ID, padrão) ou "acrcloud": o celular manda o áudio e o servidor reconhece. */
  function provider(){
    if(!providerPromise)providerPromise=fetch('/api/config').then(r=>r.json()).then(c=>c.audioRecognition==='acrcloud'?'acrcloud':c.audioRecognition==='sceneshop'?'sceneshop':'fingerprint').catch(()=>'fingerprint');
    return providerPromise;
  }
  function joinAudio(a,b){const r=a.sampleRate;const fp2=fp&&b.sampleRate!==r?fp.downsample(b.samples,b.sampleRate):b.samples;const out=new Float32Array(a.samples.length+fp2.length);out.set(a.samples,0);out.set(fp2,a.samples.length);return{samples:out,sampleRate:r};}
  const ACR_SECONDS=10;
  function errorText(data){
    if(data.error==='SYNC_NOT_RECOGNIZED')return 'Conteúdo não reconhecido. Aproxime o aparelho da fonte de áudio e tente novamente.';
    if(data.error==='ACR_UNAVAILABLE')return 'O serviço de reconhecimento não respondeu. Tente de novo em instantes.';
    if(data.error==='SYNC_SAMPLE_TOO_SHORT')return 'Amostra curta ou silenciosa demais para sincronizar.';
    return data.error||'Falha ao sincronizar.';
  }
  async function requestSync(kind,{externalUrl=null,seconds=5,workId=null,onRetry=null}={}){
    const prov=await provider();
    if(prov==='sceneshop'){
      // 10 s; se não reconhecer (sala barulhenta), ouve mais 10 s e manda os 20 s juntos
      let audio=await capture(ACR_SECONDS);
      for(let attempt=0;attempt<2;attempt++){
        const r=await fetch(`/api/sync/audio/${kind}${workId?`?workId=${encodeURIComponent(workId)}`:''}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:encodeWav(audio.samples,audio.sampleRate)});
        const data=await r.json().catch(()=>({}));
        if(r.ok){
          if(workId&&data.work&&data.work.id!==workId)throw new Error('O áudio é de outro conteúdo. Conecte de novo pela tela inicial.');
          return data;
        }
        if(data.error!=='SYNC_NOT_RECOGNIZED'||attempt)throw new Error(errorText(data));
        if(onRetry)onRetry();
        audio=joinAudio(audio,await capture(ACR_SECONDS));
      }
    }
    if(prov==='acrcloud'){
      const audio=await capture(ACR_SECONDS);
      const r=await fetch(`/api/sync/acr/${kind}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:encodeWav(audio.samples,audio.sampleRate)});
      const data=await r.json().catch(()=>({}));
      if(r.ok){
        if(workId&&data.work&&data.work.id!==workId)throw new Error('O áudio é de outro conteúdo. Conecte de novo pela tela inicial.');
        return data;
      }
      // Plano B: o mesmo trecho no reconhecimento próprio do SceneShop (com o link colado, se houver).
      const fallback=await ownFingerprint(kind,audio,{externalUrl,workId}).catch(()=>null);
      if(fallback)return fallback;
      throw new Error(errorText(data));
    }
    const audio=await capture(seconds);
    return ownFingerprint(kind,audio,{externalUrl,workId},true);
  }
  async function ownFingerprint(kind,audio,{externalUrl=null,workId=null}={},strict=false){
    if(!fp){if(strict)throw new Error('Motor de fingerprint não carregado.');return null;}
    const windows=fp.fingerprint(audio.samples,audio.sampleRate);
    if(windows.length<2){if(strict)throw new Error('Amostra curta ou silenciosa demais para sincronizar.');return null;}
    const r=await fetch(`/api/sync/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({externalUrl:externalUrl||null,workId:workId||null,samples:windows.map(x=>({hash:x.hash,offset:x.offset}))})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){if(strict)throw new Error(errorText(data));return null;}
    return data;
  }
  const recognize=(opts={})=>requestSync('recognize',opts);
  const synchronize=(opts={})=>requestSync('start',opts);
  root.SceneShopCompanionSync={capture,recognize,synchronize,provider,encodeWav,ACR_SECONDS};
})(typeof globalThis!=='undefined'?globalThis:this);
