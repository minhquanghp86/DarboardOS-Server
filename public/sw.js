/* Dashboard OS — service worker cho Web Push (nhận cuộc gọi từ P4 khi tab đóng). */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || 'Cuộc gọi đến';
  const body = d.body || 'Có cuộc gọi từ màn hình';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: d.tag || 'rwv-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 300],
    data: { call: d.call || '', from: d.from || '' },
    actions: [
      { action: 'answer', title: 'Nghe' },
      { action: 'decline', title: 'Từ chối' },
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const call = (event.notification.data || {}).call || '';
  const action = event.action || 'answer';
  const base = new URL('./call-web.html', self.registration.scope);
  if (action === 'decline') {
    if (call) fetch(new URL('calls/decline?call=' + encodeURIComponent(call), self.registration.scope), { method: 'POST' }).catch(() => {});
    return;
  }
  const url = new URL(base);
  url.searchParams.set('call', call);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('call-web.html')) { c.postMessage({ type: 'rwv-call', call }); return c.focus(); }
    }
    return self.clients.openWindow(url.href);
  })());
});
