#!/usr/bin/env node
import { build } from "esbuild";
import fs from "fs";
import path from "path";

const root = process.cwd();
const toPosix = (p) => p.split(path.sep).join("/");
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

const PROTECTED_DIRS = ["src/pages"]; // likely routed dynamically, don't hard-flag
const MOD_EXTS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const CODE_EXTS = new Set([".js",".jsx",".ts",".tsx",".css",".scss",".html",".json"]);

// ---- 1) Entry points (pick best available) ----------------------------------
const entryCandidates = [
  "src/main.tsx","src/main.jsx","src/main.ts","src/main.js",
  "src/App.tsx","src/App.jsx","src/index.tsx","src/index.jsx",
];
const entries = entryCandidates.filter((f) => exists(path.join(root, f)));
if (entries.length === 0) {
  console.error("No entry found (expected src/main.* or src/App.*).");
  process.exit(1);
}

// ---- 2) Build with safe loaders and aliases (get module graph) --------------
const result = await build({
  entryPoints: entries,
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  metafile: true,
  absWorkingDir: root,
  outdir: "node_modules/.tmp-audit",
  jsx: "automatic",
  logLevel: "silent",
  loader: {
    ".css": "text",  // leave url(...) unresolved
    ".svg": "file",
    ".png": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".webp": "file",
  },
  plugins: [
    // Treat absolute public URLs (/themes/...) as external runtime assets
    {
      name: "externalize-absolute-public-urls",
      setup(build) {
        build.onResolve({ filter: /^\// }, () => ({ external: true }));
      },
    },
    // Vite-style "@/..." alias → src/...
    {
      name: "alias-at-to-src",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
          const p = path.join(root, "src", args.path.slice(2));
          return { path: p };
        });
      },
    },
  ],
});

// Reachable inputs (posix relative)
const reachable = new Set(Object.keys(result.metafile.inputs));

// ---- 3) Collect all source modules under src/ --------------------------------
function walk(dir) {
  let list = [];
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    if (it.name === "node_modules" || it.name === ".git") continue;
    const full = path.join(dir, it.name);
    if (it.isDirectory()) list = list.concat(walk(full));
    else list.push(full);
  }
  return list;
}
const SRC_DIR = path.join(root, "src");
const allSrc = exists(SRC_DIR) ? walk(SRC_DIR) : [];
const modules = allSrc.filter((f) => {
  const ext = path.extname(f).toLowerCase();
  if (!MOD_EXTS.has(ext)) return false;
  const rel = toPosix(path.relative(root, f));
  // ignore tests/types
  if (/(^|\/)__tests__\//.test(rel)) return false;
  if (/\.d\.ts$/.test(rel)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return false;
  if (/vite-env\.d\.ts$/.test(rel)) return false;
  return true;
});

// Build a code corpus for text references (src/, public/, and root index.html)
const corpus = [];
for (const rootDir of ["src","public"]) {
  const dir = path.join(root, rootDir);
  if (!exists(dir)) continue;
  for (const f of walk(dir)) {
    const ext = path.extname(f).toLowerCase();
    if (CODE_EXTS.has(ext)) corpus.push(f);
  }
}
if (exists(path.join(root, "index.html"))) corpus.push(path.join(root, "index.html"));

// Fast text search helper
function fileContains(pat) {
  for (const f of corpus) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      if (txt.includes(pat)) return true;
    } catch {}
  }
  return false;
}

// ---- 4) Classify -------------------------------------------------------------
const reachablePosix = new Set([...reachable].map((p) => p.startsWith("./") ? p : `./${p}`));
const rows = [];
let counts = { REACHABLE:0, TEXT_REF:0, PROTECTED:0, UNREACHABLE:0 };

for (const abs of modules) {
  const rel = toPosix(path.relative(root, abs));
  const relDot = rel.startsWith("./") ? rel : `./${rel}`;
  const inGraph = reachablePosix.has(rel) || reachablePosix.has(relDot);

  let status = "REACHABLE";
  let notes = "";

  if (!inGraph) {
    // textual hints: basename, stripped extension, and likely import forms
    const base = path.basename(rel, path.extname(rel));         // e.g., Dashboard
    const relNoExt = rel.replace(/\.[^.]+$/, "");               // e.g., src/pages/Dashboard
    const likelys = [
      base,
      rel,
      relNoExt,
      `/${relNoExt}`,                 // vite public-ish strings
      `from '${relNoExt}'`, `from "./${toPosix(path.relative("src", relNoExt))}"`,
      `import('${relNoExt}'`, `import("./${toPosix(path.relative("src", relNoExt))}"`,
    ];
    const hasTextRef = likelys.some(fileContains);

    const isProtected = PROTECTED_DIRS.some((d) => rel.startsWith(`${d}/`));

    if (hasTextRef) { status = "TEXT_REF"; notes = "basename/path referenced"; }
    else if (isProtected) { status = "PROTECTED"; notes = "under protected dir (likely routed)"; }
    else { status = "UNREACHABLE"; notes = "not in graph & no text refs"; }
  }

  counts[status]++;
  rows.push({ Path: rel, Status: status, Notes: notes });
}

// ---- 5) Output CSV + console summary ----------------------------------------
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0,15);
const outDir = path.join(process.env.TEMP || process.env.TMP || ".", `cnm_mod_audit_${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
const csv = path.join(outDir, `dead-modules-${stamp}.csv`);
const header = "Path,Status,Notes\n";
fs.writeFileSync(csv, header + rows.map(r => `${r.Path},${r.Status},"${r.Notes}"`).join("\n"));

const total = rows.length;
console.log(`Scanned modules: ${total}`);
console.log(`Reachable via graph: ${counts.REACHABLE}`);
console.log(`Text-referenced: ${counts.TEXT_REF}`);
console.log(`Protected (pages): ${counts.PROTECTED}`);
console.log(`UNREACHABLE candidates: ${counts.UNREACHABLE}`);

if (counts.UNREACHABLE) {
  console.log("\nTop UNREACHABLE candidates:");
  rows.filter(r => r.Status === "UNREACHABLE").slice(0, 20).forEach(r => console.log(r.Path));
}
console.log(`\nCSV: ${csv}`);
