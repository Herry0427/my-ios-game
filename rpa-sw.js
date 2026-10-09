self.addEventListener('push', function (event) {
  event.waitUntil((async function () {
    var data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) {}
    if (self.registration.setAppBadge) {
      try { await self.registration.setAppBadge(1); } catch (e) {}
    }
    await self.registration.showNotification('RPA 有新错误', {
      body: '点击打开 Arcade 查看 RPA 报错流程',
      tag: 'rpa-new-error',
      data: { latest_id: data.latest_id || 0, url: self.registration.scope }
    });
  })());
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil((async function () {
    var clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var client of clientsList) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        return;
      }
    }
    await clients.openWindow(self.registration.scope);
  })());
});
