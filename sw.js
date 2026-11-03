/* REZK PWA: no cache for personal content, authentication, routes or API endpoints. */
const CACHE='rezk-public-assets-v3';
const PRE_CACHE=['/manifest.webmanifest','/branding/rezk-logo.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRE_CACHE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.mode==='navigate')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!url.pathname.startsWith('/branding/'))return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const clone=response.clone();void caches.open(CACHE).then(cache=>cache.put(event.request,clone));}return response;})));
});
