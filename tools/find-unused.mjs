// tools/find-unused.mjs
#!/usr/bin/env node
/**
 * tools/find-unused.mjs
 *
 * Purpose:
 *  - Traverse your project (JS/TS/JSX/TSX/CSS/JSON) and build a best-effort dependency graph.
 *  - Identify:
 *      1) Orphans (no inbound refs from any entry; not reachable from entries)
 *      2) Probably Unused (suspected due to dynamic imports / weak references / alias gaps)
 *      3) Dead Exports (exported symbols never imported anywhere)
 *      4) Kept by Convention (config/tests/types/theme/etc.)
 *
 * Usage:
 *  node tools/find-unused.mjs --roots src --entries src/main.jsx src/index.html \
 *    --extensions ".js,.jsx,.ts,.tsx,.json,.css" \
 *    --ignore "**/node_modules/**,**/dist/**,**/.*/**"
 *
 * Output:
 *  - Prints JSON to stdout.
 *  - Writes tools/find-unused-report.json and tools/find-unused-report.md.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// ---- CLI Args ----
const argv = process.argv.slice(2);
function list(flag, def = []) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return def;
  const next = argv[idx + 1];
  if (!next) return def;
  return next.split(',').map(s => s.trim()).filter(Boolean);
}
function multi(flag, def = []) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return def;
  const vals = [];
  for (let i = idx + 1; i < argv.length; i++) {
    const v = argv[i];
    if (v.startsWith('--')) break;
    vals.push(v);
  }
  return vals.length ? vals : def;
}

const roots = multi('--roots', ['src']);
const entries = multi('--entries', ['src/main.jsx', 'src/index.html']);
const extensions = list('--extensions', ['.js','.jsx','.ts','.tsx','.json','.css']);
const ignore = list('--ignore', ['**/node_modules/**','**/dist/**','**/.*/**']);

const projectRoot = process.cwd();
const toolsDir = path.join(projectRoot, 'tools');

function norm(p){ return path.resolve(projectRoot, p); }
async function pathExists(p){ try { await fsp.access(p); return true; } catch { return false; } }

// ---- File Walker ----
async function* walk(dir){
  const ents = await fsp.readdir(dir, {withFileTypes:true});
  for (const e of ents){
    const abs = path.join(dir,e.name);
    if (ignore.some(g => abs.includes(g.replace(/\*+/g,'')))) continue;
    if (e.isDirectory()) yield* walk(abs);
    else yield abs;
  }
}

function hasExt(f){ return extensions.includes(path.extname(f).toLowerCase()); }

// ---- Regex Parsers ----
const re = {
  import: /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
  importDyn: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  require: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  exportFrom: /export\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
  cssImport: /@import\s+['"]([^'"]+)['"]/g,
  newURL: /new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  namedExport: /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z0-9_$]+)/g,
  namedExportList: /export\s*{\s*([^}]+)\s*}/g,
  defaultExport: /export\s+default\s+/g
};
function parse(content,isCss=false){
  const imports=new Set(), named=new Set(); let hasDef=false;
  if(isCss){ for(const m of content.matchAll(re.cssImport)) imports.add(m[1]); return {imports:[...imports],named:[],hasDef:false}; }
  for(const r of [re.import,re.importDyn,re.require,re.exportFrom,re.newURL]) for(const m of content.matchAll(r)) imports.add(m[1]);
  for(const m of content.matchAll(re.namedExport)) named.add(m[1]);
  for(const m of content.matchAll(re.namedExportList)){ m[1].split(',').map(s=>s.trim()).forEach(n=>{if(n)named.add(n.split(/\s+as\s+/i)[0]);}); }
  if(re.defaultExport.test(content)) hasDef=true;
  return {imports:[...imports],named:[...named],hasDef};
}

// ---- Build Graph ----
async function collectFiles(){
  const out=[];
  for(const r of roots){
    const abs=norm(r);
    if(!(await pathExists(abs))) continue;
    for await(const f of walk(abs)){ if(hasExt(f)) out.push(f); }
  }
  for(const e of entries){ const abs=norm(e); if(await pathExists(abs)&&hasExt(abs)) out.push(abs); }
  return out;
}

async function resolveImport(from,spec){
  if(!spec) return null;
  if(!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('src/')) return null;
  const base=path.dirname(from);
  const c = spec.startsWith('/')
    ? norm(spec)
    : spec.startsWith('src/')
      ? norm(spec)
      : path.resolve(base,spec);
  if(await pathExists(c)) return c;
  for(const ext of extensions){ if(await pathExists(c+ext)) return c+ext; }
  if(await pathExists(c) && fs.statSync(c).isDirectory()){
    for(const ext of extensions){ const idx=path.join(c,'index'+ext); if(await pathExists(idx)) return idx; }
  }
  return null;
}

async function buildGraph(files){
  const graph=new Map(), symbols=new Map();
  for(const f of files){
    const c=await fsp.readFile(f,'utf8').catch(()=>''), ext=path.extname(f).toLowerCase();
    const {imports:namedImports,named,hasDef}=parse(c,ext=='.css');
    const resolved=new Set(),dyn=new Set();
    for(const s of namedImports){ const r=await resolveImport(f,s); r?resolved.add(r):dyn.add(s); }
    graph.set(f,{imports:resolved,unresolved:dyn,exports:{named,default:hasDef}});
    for(const sym of named){ if(!symbols.has(sym)) symbols.set(sym,new Set()); symbols.get(sym).add(f); }
  }
  return {graph,symbols};
}

function reachable(graph,entriesAbs){
  const seen=new Set(), stack=[...entriesAbs];
  while(stack.length){
    const cur=stack.pop(); if(seen.has(cur)) continue; seen.add(cur);
    const node=graph.get(cur); if(!node) continue;
    for(const dep of node.imports){ if(!seen.has(dep)) stack.push(dep); }
  }
  return seen;
}

function collectImports(graph){
  const count=new Map();
  const re1=/import\s*{([^}]+)}/g, re2=/const\s*{([^}]+)}\s*=\s*require\(/g;
  for(const [f] of graph){
    const c=fs.readFileSync(f,'utf8');
    for(const re of [re1,re2]){
      for(const m of c.matchAll(re)){
        m[1].split(',').map(s=>s.trim().split(/\s+as\s+/i)[0]).forEach(n=>{if(n)count.set(n,(count.get(n)||0)+1);});
      }
    }
  }
  return count;
}

function classify(graph,reach,entriesAbs){
  const all=[...graph.keys()], rset=new Set(reach), entriesSet=new Set(entriesAbs);
  const orphans=[], prob=[], kept=[];
  const reasons=new Map();
  const keepRe=/(tailwind\.config|vitest\.config|postcss\.config|jest\.config|eslint|prettier|setupTests|env\.d\.ts|types\.ts|index\.html|global\.css|manifest\.json)$/i;
  const add=(f,r)=>{if(!reasons.has(f))reasons.set(f,[]);reasons.get(f).push(r);};
  for(const f of all){
    if(entriesSet.has(f)){ kept.push(f); add(f,'Entry'); continue; }
    if(keepRe.test(f)){ kept.push(f); add(f,'Convention'); continue; }
    const node=graph.get(f), hasDyn=node.unresolved.size>0;
    if(!rset.has(f)){ hasDyn?(prob.push(f),add(f,'Unreachable; dynamic/unresolved')):(orphans.push(f),add(f,'Unreachable')); }
    else if(hasDyn){ prob.push(f); add(f,'Reachable but dynamic/unresolved'); }
  }
  return {orphans,prob,kept,reasons};
}

(async()=>{
  const files=await collectFiles();
  const {graph}=await buildGraph(files);
  const entriesAbs=entries.map(norm).filter(fs.existsSync);
  const reach=reachable(graph,entriesAbs);
  const importCounts=collectImports(graph);
  const dead=[];
  for(const [f,node] of graph){
    for(const n of node.exports.named){ if(!importCounts.get(n)) dead.push({file:f,export:n}); }
  }
  const cls=classify(graph,reach,entriesAbs);
  const rep={when:new Date().toISOString(),roots,entries:entriesAbs,
    totals:{scanned:files.length,reachable:reach.size,orphans:cls.orphans.length,probablyUnused:cls.prob.length,deadExports:dead.length,kept:cls.kept.length},
    buckets:{orphans:cls.orphans,probablyUnused:cls.prob,deadExports:dead,keptByConvention:cls.kept}};
  await fsp.mkdir(toolsDir,{recursive:true});
  await fsp.writeFile(path.join(toolsDir,'find-unused-report.json'),JSON.stringify(rep,null,2));
  console.log(JSON.stringify(rep,null,2));
})();
