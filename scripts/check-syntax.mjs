#!/usr/bin/env node
// CI syntax gate (Phase 8 · Step 1)
// ---------------------------------
// Runs `node --check` over the server-side JavaScript surface so a broken file
// can never reach a deploy. Pure Node, zero dependencies; works locally and in
// GitHub Actions. JSX (client/src/**/*.jsx) is covered by the Vite build step.
import { readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
// Directories whose .js files are plain Node modules (no JSX).
const SCAN_DIRS = ['routes', 'services', 'middleware'];
// Individual entry files at the repo root.
const ROOT_FILES = ['server.js', 'index.js'];
const SKIP = new Set(['node_modules', 'dist', '.git', '.local', 'client']);

function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
    } else if (extname(name) === '.js' || extname(name) === '.mjs') {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) collect(join(ROOT, d), files);
for (const f of ROOT_FILES) {
  try {
    statSync(join(ROOT, f));
    files.push(join(ROOT, f));
  } catch {
    // entry file is optional
  }
}

let failed = 0;
for (const file of files) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    const detail = (err.stderr && err.stderr.toString()) || err.message;
    console.error(`✗ ${relative(ROOT, file)}`);
    console.error(detail.trim());
  }
}

console.log(`\nChecked ${files.length} server file(s), ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
