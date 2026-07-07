---
'@node-xray/core': patch
---

Ignore Chrome DevTools' `/.well-known/appspecific/` probe requests by default — with DevTools open, Chrome fires one per page load and each showed up in the dashboard as a 404, polluting the request list and error count.
