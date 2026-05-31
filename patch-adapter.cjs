const fs = require('fs');
const path = 'node_modules/@astrojs/cloudflare/dist/wrangler.js';
if (fs.existsSync(path)) {
  let c = fs.readFileSync(path, 'utf8');
  // Remove session KV injection entirely
  c = c.replace(/if\s*\(sessionKVBindingName\)[^}]*}/gs, '');
  c = c.replace(/warnIfSessionKVBindingMissing[^;]*;/g, '');
  fs.writeFileSync(path, c);
  console.log('Patched session KV binding');
}
