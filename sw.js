/* Push only: no fetch interception or offline asset cache to mix app versions. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  // Generic text avoids exposing one learner's study details on a shared lock screen.
  event.waitUntil(self.registration.showNotification('Time for a little Japanese',{
    body:'Your Komorebi reviews are ready. Open your study space when you have a moment.',
    icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:'komorebi-reviews',
    data:{url:new URL('./#dashboard',self.registration.scope).href}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL('./#dashboard',self.registration.scope).href;
  event.waitUntil((async()=>{
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const app=tabs.find(client=>client.url.startsWith(self.registration.scope));
    if(app){await app.navigate(target);return app.focus();}
    return self.clients.openWindow(target);
  })());
});
