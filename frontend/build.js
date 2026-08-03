/**
 * Frontend build (Ares-parity pattern, page-manifest form).
 * Assembles public/*.html from frontend/ source files.
 *
 * Usage: node frontend/build.js
 *
 * Each shell contains markers:
 *   <!-- inject:css -->        → concatenated styles (wrapped in <style>)
 *   <!-- inject:templates -->  → concatenated template files
 *   <!-- inject:js -->         → concatenated scripts (wrapped in <script>)
 *
 * Every template is parse-checked with the SAME Ractive version the pages
 * load (pinned in devDependencies and copied to public/vendor), so a
 * broken template is a build failure, not a blank page.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ractive from 'ractive';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public');

function read(kind, name, ext) {
  const file = path.join(__dirname, kind, name + ext);
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  const body = fs.readFileSync(file, 'utf8');
  if (ext === '.html') assertParses(name + ext, body);
  return body;
}

function assertParses(name, body) {
  try {
    // Templates ship inside <script type="text/ractive"> wrappers; parse the inner bodies.
    const inner = [...body.matchAll(/<script[^>]*type="text\/ractive"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, tpl] of inner) Ractive.parse(tpl);
    if (inner.length === 0) Ractive.parse(body);
  } catch (err) {
    throw new Error(`Ractive cannot parse ${name}:\n  ${err.message}`);
  }
}

const PAGES = {
  'login.html': {
    css: ['variables', 'base', 'login'],
    templates: [],
    js: ['api', 'login'],
  },
  'index.html': {
    css: ['variables', 'base', 'nav', 'buttons', 'forms', 'cards', 'capture', 'states'],
    templates: ['home', 'capture', 'detail'],
    js: ['api', 'helpers', 'app'],
  },
  'lead.html': {
    css: ['variables', 'base', 'nav', 'buttons', 'forms', 'cards', 'states', 'lead'],
    templates: ['lead-dashboard'],
    js: ['api', 'helpers', 'lead'],
  },
  'admin.html': {
    css: ['variables', 'base', 'nav', 'buttons', 'forms', 'cards', 'states', 'admin'],
    templates: ['admin-dashboard'],
    js: ['api', 'helpers', 'admin'],
  },
};

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const [page, manifest] of Object.entries(PAGES)) {
  let shell = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const css = manifest.css.map((n) => read('styles', n, '.css')).join('\n\n');
  const templates = manifest.templates.map((n) => read('templates', n, '.html')).join('\n\n');
  const js = manifest.js.map((n) => read('scripts', n, '.js')).join('\n\n');

  shell = shell.replace('<!-- inject:css -->', `<style>\n${css}\n  </style>`);
  shell = shell.replace('<!-- inject:templates -->', templates);
  shell = shell.replace('<!-- inject:js -->', `<script>\n${js}\n  </script>`);

  fs.writeFileSync(path.join(outDir, page), shell);
  console.log(`Built public/${page}`);
}

// Vendor: serve the pinned Ractive locally (no CDN dependency).
const vendorDir = path.join(outDir, 'vendor');
if (!fs.existsSync(vendorDir)) fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '..', 'node_modules', 'ractive', 'ractive.min.js'),
  path.join(vendorDir, 'ractive.min.js'),
);
console.log('Copied vendor/ractive.min.js');
