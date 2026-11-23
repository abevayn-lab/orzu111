self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let data={};try{data=e.data?e.data.json():{}}catch(_){data={body:e.data?e.data.text():'Yangi buyurtma'};}
  e.waitUntil(self.registration.showNotification(data.title||'ORZU · YANGI BUYURTMA',{
    body:data.body||'Yangi taom buyurtmasi keldi',icon:'/station/icon.svg',badge:'/station/icon.svg',
    tag:data.tag||('orzu-'+Date.now()),renotify:true,requireInteraction:true,
    vibrate:[350,120,350,120,650,180,350],data:{url:data.url||'/'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();const target=new URL(e.notification.data&&e.notification.data.url||'/',self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
    for(const client of list){if('focus'in client){if(client.url!==target&&'navigate'in client)await client.navigate(target);return client.focus();}}
    return self.clients.openWindow(target);
  }));
});
