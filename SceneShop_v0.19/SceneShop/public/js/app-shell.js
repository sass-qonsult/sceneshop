(function(){
  'use strict';
  const core=window.SceneShopAppCore;
  const contract=window.SceneShopNativeContract;
  const surface=core?core.normalizeSurface(document.body.dataset.surface):'WEB';
  const caps=core?core.capabilities(surface):{surface,installable:true};
  document.documentElement.dataset.surface=surface.toLowerCase();
  document.body.classList.add(`surface-${surface.toLowerCase()}`);
  document.querySelectorAll('[data-surface-label]').forEach((el)=>{el.textContent=surface==='WEB'?'Web':surface==='DESKTOP'?'Desktop':'Mobile';});
  document.querySelectorAll('[data-surface-link]').forEach((el)=>{
    const target=el.dataset.surfaceLink;
    if(core) el.href=core.buildSurfaceUrl(target,{code:core.resolveSessionCode(location),source:core.resolveSharedSource(location)});
    if(core&&core.normalizeSurface(target)===surface) el.setAttribute('aria-current','page');
  });

  let deferredInstall=null;
  const installButtons=[...document.querySelectorAll('[data-install-app]')];
  const setInstallVisible=(visible)=>installButtons.forEach((b)=>b.hidden=!visible);
  setInstallVisible(false);
  window.addEventListener('beforeinstallprompt',(event)=>{event.preventDefault();deferredInstall=event;if(caps.installable)setInstallVisible(true);});
  installButtons.forEach((button)=>button.addEventListener('click',async()=>{
    if(!deferredInstall)return;deferredInstall.prompt();try{await deferredInstall.userChoice;}catch(e){}deferredInstall=null;setInstallVisible(false);
  }));
  window.addEventListener('appinstalled',()=>{deferredInstall=null;setInstallVisible(false);});

  const pending=new Map();
  const requestId=()=>`ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  function nativeAvailable(){
    return Boolean((window.SceneShopNative&&typeof window.SceneShopNative.postMessage==='function')||(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.sceneshop));
  }
  function sendNative(message){
    try{
      if(window.SceneShopNative&&typeof window.SceneShopNative.postMessage==='function'){window.SceneShopNative.postMessage(JSON.stringify(message));return true;}
      if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.sceneshop){window.webkit.messageHandlers.sceneshop.postMessage(message);return true;}
    }catch(e){return false;}
    return false;
  }
  function resolveNativeResponse(detail={}){
    const id=String(detail.requestId||'');
    const item=pending.get(id);if(!item)return;
    pending.delete(id);clearTimeout(item.timer);
    if(detail.ok===false)item.reject(new Error(String(detail.error||'NATIVE_ERROR')));else item.resolve(detail.value);
  }
  window.addEventListener('sceneshop:native-response',(event)=>resolveNativeResponse(event.detail||{}));
  window.SceneShopNativeResolve=(response)=>resolveNativeResponse(typeof response==='string'?JSON.parse(response):response);
  function dispatchNativeEvent(detail={}){
    const value=typeof detail==='string'?(()=>{try{return JSON.parse(detail);}catch{return {type:'NATIVE_EVENT_PARSE_ERROR',raw:String(detail)}};})():detail;
    window.dispatchEvent(new CustomEvent('sceneshop:native-event',{detail:value||{}}));
  }
  window.SceneShopNativeEvent=(event)=>dispatchNativeEvent(event);

  function dispatchLifecycle(state,source='web'){
    const detail={state:String(state||'UNKNOWN').toUpperCase(),source,online:navigator.onLine!==false,at:Date.now()};
    window.dispatchEvent(new CustomEvent('sceneshop:app-lifecycle',{detail}));
    return detail;
  }
  document.addEventListener('visibilitychange',()=>dispatchLifecycle(document.visibilityState==='hidden'?'BACKGROUND':'FOREGROUND','visibility'));
  window.addEventListener('online',()=>dispatchLifecycle('ONLINE','network'));
  window.addEventListener('offline',()=>dispatchLifecycle('OFFLINE','network'));
  window.addEventListener('pageshow',()=>dispatchLifecycle('FOREGROUND','pageshow'));
  window.addEventListener('pagehide',()=>dispatchLifecycle('BACKGROUND','pagehide'));
  window.addEventListener('sceneshop:native-event',(event)=>{
    const detail=event.detail||{};
    if(String(detail.type||'').toUpperCase()==='APP_LIFECYCLE') dispatchLifecycle(detail.payload&&detail.payload.state||'UNKNOWN','native');
  });

  const bridge={
    surface,
    capabilities:caps,
    notify(type,payload={}){
      const message={version:contract?.MESSAGE_VERSION||1,type:String(type||'').toUpperCase(),payload,surface,at:Date.now()};
      if(contract&&!contract.validateRequest({...message,requestId:''}).ok)return false;
      if(sendNative(message))return true;
      window.dispatchEvent(new CustomEvent('sceneshop:native',{detail:message}));return false;
    },
    request(type,payload={},timeoutMs=5000){
      const message={version:contract?.MESSAGE_VERSION||1,type:String(type||'').toUpperCase(),payload,surface,at:Date.now(),requestId:requestId()};
      const validation=contract?contract.validateRequest(message):{ok:true};
      if(!validation.ok)return Promise.reject(new Error(validation.error));
      if(!sendNative(message))return Promise.reject(new Error('NATIVE_BRIDGE_UNAVAILABLE'));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(message.requestId);reject(new Error('NATIVE_BRIDGE_TIMEOUT'));},Math.max(250,Number(timeoutMs)||5000));
        pending.set(message.requestId,{resolve,reject,timer});
      });
    }
  };
  window.SceneShopAppBridge=bridge;

  async function copyShareUrl(url){
    if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
      await navigator.clipboard.writeText(url);return true;
    }
    const input=document.createElement('textarea');input.value=url;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();
    let copied=false;try{copied=document.execCommand('copy');}finally{input.remove();}
    return copied;
  }
  const shareButtons=[...document.querySelectorAll('[data-share-app]')];
  shareButtons.forEach((button)=>{
    button.hidden=!caps.shareTarget;
    button.addEventListener('click',async()=>{
      const code=core?core.resolveSessionCode(location):'';
      const source=core?core.resolveSharedSource(location):'';
      const relative=core?core.buildSurfaceUrl(surface,{code,source}):location.pathname+location.search;
      const url=new URL(relative,location.origin).toString();
      const payload={title:document.title||'SceneShop',url};
      const before=button.textContent;button.disabled=true;
      try{
        if(nativeAvailable()){
          await bridge.request('SHARE',payload,15000);
          button.textContent='Compartilhado';
        }else if(typeof navigator.share==='function'){
          await navigator.share(payload);
          button.textContent='Compartilhado';
        }else if(await copyShareUrl(url)){
          button.textContent='Link copiado';
        }else throw new Error('SHARE_UNAVAILABLE');
      }catch(error){
        if(error&&error.name==='AbortError') button.textContent=before;
        else button.textContent='Não foi possível compartilhar';
      }finally{
        setTimeout(()=>{button.textContent=before;button.disabled=false;},1800);
      }
    });
  });
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  bridge.notify('NATIVE_READY',{href:location.href});
})();
