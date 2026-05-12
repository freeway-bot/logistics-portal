// Generates public/_redirects at Netlify build time.
// Requires RAILWAY_URL env var to be set in Netlify dashboard.
// Example: RAILWAY_URL = https://logistics-portal-production.up.railway.app

const fs   = require('fs');
const path = require('path');

const railwayUrl = (process.env.RAILWAY_URL || '').replace(/\/$/, '');

if (!railwayUrl) {
  console.warn('[gen-redirects] WARNING: RAILWAY_URL is not set — API proxy will not work.');
  fs.writeFileSync(path.join(__dirname, '../public/_redirects'), '# RAILWAY_URL not set — add it in Netlify env vars\n');
  process.exit(0);
}

// SPA fallback → client.html (этот сайт lk.freewaychina.com — только для клиентов)
const content = `/api/*  ${railwayUrl}/api/:splat  200\n/*      /client.html           200\n`;
fs.writeFileSync(path.join(__dirname, '../public/_redirects'), content);
console.log(`[gen-redirects] Written: /api/* → ${railwayUrl}/api/:splat  +  SPA → client.html`);
