const CACHE='poker-trainer-v34';
const CORE=['./','./index.html','./texas_holdem_trainer.html','./gto_engine.js','./strategy_pack.js','./core/index.mjs','./core/version.mjs','./core/cards.mjs','./core/table_state.mjs','./core/equity.mjs','./core/ev.mjs','./core/icm.mjs','./core/player_profile.mjs','./core/session_stats.mjs','./core/bot_profiles.mjs','./core/strategy_pack.mjs','./core/strategy_audit.mjs','./core/dealer.mjs','./core/training_table.mjs','./core/table_presentation.mjs','./manifest.webmanifest','./icon.svg'];

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.pathname.includes('/api/'))return;
  const cacheRequest=url.pathname.endsWith('/core/index.mjs')?new Request(`${url.origin}${url.pathname}`):event.request;
  event.respondWith(caches.match(cacheRequest).then(cached=>cached||fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(cacheRequest,copy));
    return response;
  }).catch(()=>event.request.destination==='document'?caches.match('./texas_holdem_trainer.html'):new Response('Offline resource unavailable',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}}))));
});
