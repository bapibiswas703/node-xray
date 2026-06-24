---
'@node-xray/types': patch
'@node-xray/dashboard': patch
'@node-xray/core': patch
'@node-xray/express': patch
'@node-xray/fastify': patch
'@node-xray/nestjs': patch
---

Re-publish to attach npm provenance attestation. No code change.

The first publish (0.2.1/0.3.1/0.2.2) was done from a local CLI which
cannot generate provenance. This patch triggers the CI release
workflow which has `id-token: write` permission and will publish
each package with a SLSA provenance attestation via sigstore.
