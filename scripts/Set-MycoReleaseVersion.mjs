// scripts/Set-MycoReleaseVersion.mjs
// Explicit release-only version bump; no dependency install, commit, push or deploy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../src/lib/appUpdates.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [next, ...notes] = process.argv.slice(2);
if (!next || !/^\d+\.\d+\.\d+$/.test(next) || !notes.length || notes.some(n=>!n.trim())) {
  throw new Error('Usage: node scripts/Set-MycoReleaseVersion.mjs 1.1.6 "Release note" "Another note"');
}
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const gradle = read('android/app/build.gradle');
const cargo = read('src-tauri/Cargo.toml');
const current = pkg.version;
if (compareVersions(next,current)<=0) throw new Error('Release version must increase.');
const name = gradle.match(/\bversionName\s+["']([^"']+)["']/);
const code = gradle.match(/\bversionCode\s+(\d+)/);
const rust = cargo.match(/^version\s*=\s*"([^"]+)"/m);
if ([lock.version,lock.packages?.['']?.version,tauri.version,name?.[1],rust?.[1]].some(v=>v!==current)||!code||Number(code[1])>=2100000000) throw new Error('Versions are not synchronized or Android versionCode invalid.');
pkg.version=next; pkg.mycoReleaseNotes=notes;
lock.version=next; lock.packages[''].version=next;
tauri.version=next;
const json=x=>JSON.stringify(x,null,2)+'\n';
const changed={
  'package.json':json(pkg), 'package-lock.json':json(lock), 'src-tauri/tauri.conf.json':json(tauri),
  'android/app/build.gradle':gradle.replace(name[0],`versionName "${next}"`).replace(code[0],`versionCode ${Number(code[1])+1}`),
  'src-tauri/Cargo.toml':cargo.replace(rust[0],`version = "${next}"`)
};
for(const [p,content] of Object.entries(changed)) fs.writeFileSync(path.join(root,p),content,'utf8');
console.log(`Synchronized ${current} -> ${next}; Android versionCode ${Number(code[1])+1}.`);
