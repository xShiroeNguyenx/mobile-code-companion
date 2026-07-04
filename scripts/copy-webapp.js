// Copies the built mobile web app into the extension so it can be served and packaged.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'webapp', 'dist');
const dest = path.join(__dirname, '..', 'extension', 'webapp-dist');

if (!fs.existsSync(src)) {
  console.error('webapp/dist not found. Run "npm run build:webapp" first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
