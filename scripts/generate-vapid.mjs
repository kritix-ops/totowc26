// One-shot VAPID key generator for the push-notification feature.
//
// Usage:
//   node scripts/generate-vapid.mjs
//
// Prints the two keys to stdout. Copy them into .env.local (dev) and
// into the Vercel environment variables (prod) under:
//
//   VAPID_PUBLIC_KEY   - the public component, also served by
//                        /api/push/public-key for the client subscribe
//                        flow.
//   VAPID_PRIVATE_KEY  - never exposed to the client. Used by
//                        web-push on the server when sending.
//   VAPID_SUBJECT      - a contact mailto: URL for the push service
//                        operator. Required by the VAPID spec. Set to
//                        the admin email, e.g.
//                        "mailto:yoav@kritix.io".
//
// Generate once per deployment. Rotating keys invalidates every
// existing subscription so users have to re-grant permission.

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("# Add the following to .env.local + Vercel env:");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:yoav@kritix.io");
