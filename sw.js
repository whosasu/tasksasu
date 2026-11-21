/* Tasks ASÜ — service worker: push notifications, deep links, offline shell */
const CACHE = 'tasks-asu-v3'
const SHELL = ['./']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // skip API traffic (REST + edge fns other than the app shell)
  if (url.pathname.includes('/rest/')) return
  if (url.pathname.includes('/functions/v1/')) return
  // network-first, cache for offline
  e.respondWith(
    // documents always bypass the HTTP cache (no stale builds); assets stay network-first
    fetch(req.mode === 'navigate' ? new Request(req, { cache: 'no-store' }) : req).then(res => {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {})
      return res
    }).catch(() => caches.match(req).then(m => m || caches.match('./')))
  )
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data.json() } catch (_) { d = { title: 'Reminder', body: e.data ? e.data.text() : '' } }
  // hyper push: one remote push becomes N local notifications 2s apart (works app closed too)
  const hyper = (typeof d.hyper === 'number' && d.hyper > 1) ? Math.min(30, Math.floor(d.hyper)) : 1
  const baseTag = d.tag || ('task-' + (d.itemId || 'x') + '-' + Date.now())
  const show = (k) => self.registration.showNotification(
    (hyper > 1 && k > 1) ? ((d.title || 'Reminder') + ' (' + k + '/' + hyper + ')') : (d.title || 'Reminder'),
    {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: hyper > 1 ? baseTag + '-h' + k : baseTag,
      data: { itemId: d.itemId, url: d.url },
    }
  )
  if (hyper === 1) { e.waitUntil(show(1)); return }
  e.waitUntil((async () => {
    for (let k = 1; k <= hyper; k++) {
      try { await show(k) } catch (_) {}
      if (k < hyper) await new Promise((r) => setTimeout(r, 2000))
    }
  })())
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
