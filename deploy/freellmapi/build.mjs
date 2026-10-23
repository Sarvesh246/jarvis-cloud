import { mkdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { patchImageReferences } from './image-reference-patch.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

// Upstream v0.14.2, pinned so a catalog/server change cannot silently deploy.
const revision = '57c0669233bbe0c70a0f9f9927613192be948773';
if (!existsSync('vendor/package-lock.json')) {
  const temp = mkdtempSync(path.join(tmpdir(), 'vaelo-router-build-'));
  const archive = path.join(temp, 'source.tar.gz');
  const response = await fetch(`https://codeload.github.com/tashfeenahmed/freellmapi/tar.gz/${revision}`);
  if (!response.ok) throw new Error('Could not download the pinned FreeLLMAPI source.');
  writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
  mkdirSync('vendor', { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', 'vendor'], {stdio:'inherit'});
}
const proxyPath = 'vendor/server/src/routes/proxy.ts';
const mediaPath = 'vendor/server/src/services/media.ts';
const patched = patchImageReferences(readFileSync(proxyPath, 'utf8'), readFileSync(mediaPath, 'utf8'));
writeFileSync(proxyPath, patched.proxy);
writeFileSync(mediaPath, patched.media);
const manifest = JSON.parse(readFileSync('vendor/package.json', 'utf8'));
manifest.overrides = {...manifest.overrides, 'proxy-addr':'2.0.8'};
writeFileSync('vendor/package.json', JSON.stringify(manifest, null, 2));
execSync('npm update proxy-addr --package-lock-only --ignore-scripts --no-audit --no-fund', {cwd:'vendor', stdio:'inherit'});
execSync('npm ci', {cwd:'vendor', stdio:'inherit'});
execSync('npm run build:server', {cwd:'vendor', stdio:'inherit'});
execSync('npm prune --omit=dev', {cwd:'vendor', stdio:'inherit'});
mkdirSync('public', {recursive:true});
writeFileSync('public/robots.txt', 'User-agent: *\nDisallow: /\n');
