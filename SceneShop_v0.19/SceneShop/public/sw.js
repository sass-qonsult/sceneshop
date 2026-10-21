const CACHE='sceneshop-app-v019-rc1-r8';
const CORE=[
  '/app','/desktop','/mobile','/app.html','/desktop.html','/mobile.html','/offline.html',
  '/css/mobile.css','/css/app-shell.css',
  '/js/i18n-dict.js','/js/i18n.js','/js/mobile.js','/js/sync-fingerprint.js','/js/companion-sync.js','/js/mobile-core.js','/js/app-core.js','/js/native-bridge-contract.js','/js/app-shell.js',
  '/app.webmanifest','/desktop.webmanifest','/mobile.webmanifest',
  '/media/app/sceneshop-192.png','/media/app/sceneshop-512.png'
];
self.addEventListener('install',(event)=>event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',(event)=>event.waitUntil(Promise.all([
  caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key.startsWith('sceneshop-')&&key!==CACHE).map((key)=>caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch',(event)=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then((response)=>{
    if(response&&response.ok&&url.pathname.startsWith('/media/')){
      const clone=response.clone();caches.open(CACHE).then((cache)=>cache.put(event.request,clone));
    }
    return response;
  }).catch(async()=>{
    const cached=await caches.match(event.request);
    if(cached)return cached;
    if(event.request.mode==='navigate')return caches.match('/offline.html');
    return Response.error();
  }));
});
