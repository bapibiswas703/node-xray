# @node-xray/express

Express middleware adapter for `node-xray`.

> Implementation lands in P2. The P0 stub is a pass-through middleware so the build chain is testable.

```js
const { xray } = require('@node-xray/express');
app.use(xray());
```
