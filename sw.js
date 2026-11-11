/* Tasks ASÜ — service worker: push notifications, deep links, offline shell */
const CACHE = 'tasks-asu-v2'
const SHELL = ['./']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      // R35: reload open windows once through the new no-store fetch path so a fresh
      // build reaches the phone on the very next app open — stale PWA builds are over.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(list => { for (const c of list) { try { c.navigate(c.url) } catch (_) {} } })
      .catch(() => {})
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // skip API traffic (REST + edge fns other than the app shell)
  if (url.pathname.includes('/rest/')) return
  if (url.pathname.includes('/functions/v1/notify') || url.pathname.includes('/functions/v1/ai-parse')) return
  // R35: documents/navigations ALWAYS bypass the HTTP cache (no more stale builds);
  // other assets stay network-first with an offline fallback.
  const isDoc = req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')
  e.respondWith(
    fetch(isDoc ? new Request(req, { cache: 'no-store' }) : req).then(res => {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {})
      return res
    }).catch(() => caches.match(req).then(m => m || caches.match('./')))
  )
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data.json() } catch (_) { d = { title: 'Reminder', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Reminder', {
    body: d.body || '',
    tag: d.tag || ('task-' + (d.itemId || 'x') + '-' + Date.now()),
    data: { itemId: d.itemId, url: d.url },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = (e.notification.data && e.notification.data.url) || './'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { try { c.navigate(target) } catch (_) {} return c.focus() }
      }
      return clients.openWindow(target)
    })
  )
})
