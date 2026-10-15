(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SceneShopAppCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const SURFACES=Object.freeze({WEB:'WEB',DESKTOP:'DESKTOP',MOBILE:'MOBILE'});
  const PATHS=Object.freeze({WEB:'/app',DESKTOP:'/desktop',MOBILE:'/mobile'});
  function normalizeSurface(value){
    const v=String(value||'').trim().toUpperCase();
    return SURFACES[v]||SURFACES.WEB;
  }
  function searchParams(value){
    if(value instanceof URLSearchParams) return value;
    const raw=String(value||'');
    return new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw);
  }
  function cleanCode(value){
    const code=String(value||'').trim().toUpperCase();
    return /^[A-Z0-9_-]{3,64}$/.test(code)?code:'';
  }
  function resolveSessionCode(locationLike={}){
    const q=searchParams(locationLike.search||'');
    const queryCode=cleanCode(q.get('code')||q.get('session'));
    if(queryCode) return queryCode;
    const parts=String(locationLike.pathname||'').split('/').filter(Boolean);
    if(parts[0]==='s'&&parts[1]) return cleanCode(parts[1]);
    return '';
  }
  function resolveSharedSource(locationLike={}){
    const q=searchParams(locationLike.search||'');
    return String(q.get('source')||q.get('url')||'').trim();
  }
  function capabilities(surface){
    const s=normalizeSurface(surface);
    return Object.freeze({
      surface:s,
      installable:true,
      shareTarget:s!==SURFACES.DESKTOP,
      compactLayout:s===SURFACES.MOBILE,
      keyboardNavigation:s!==SURFACES.MOBILE,
      nativeBridge:true,
      externalPlaybackSync:true,
      commerceTimeline:true,
    });
  }
  function buildSurfaceUrl(surface,{code='',source=''}={}){
    const s=normalizeSurface(surface), params=new URLSearchParams();
    const c=cleanCode(code); if(c) params.set('code',c);
    if(source) params.set('source',String(source));
    const qs=params.toString();
    return PATHS[s]+(qs?`?${qs}`:'');
  }
  function preferredSurface({coarsePointer=false,standalone=false,width=0}={}){
    if(coarsePointer||Number(width||0)<760) return SURFACES.MOBILE;
    if(standalone) return SURFACES.DESKTOP;
    return SURFACES.WEB;
  }
  return{SURFACES,PATHS,normalizeSurface,cleanCode,resolveSessionCode,resolveSharedSource,capabilities,buildSurfaceUrl,preferredSurface};
});
