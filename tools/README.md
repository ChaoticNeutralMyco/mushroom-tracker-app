<!-- tools/README.md -->

\# tools/find-unused.mjs — Repository Analyzer



\## Purpose

Scans your codebase (`.js/.jsx/.ts/.tsx/.json/.css`) and builds a \*\*dependency graph\*\* to flag:

1\. \*\*Orphans\*\* — not imported by anything (safe to delete after review).

2\. \*\*Probably Unused\*\* — have dynamic/unresolved imports (needs eyes).

3\. \*\*Dead Exports\*\* — exported symbols never imported anywhere.

4\. \*\*Kept by Convention\*\* — config or entry files (kept automatically).



---



\## Usage



From your project root:



```bash

node tools/find-unused.mjs \\

&nbsp; --roots src \\

&nbsp; --entries src/main.jsx src/index.html \\

&nbsp; --extensions ".js,.jsx,.ts,.tsx,.json,.css" \\

&nbsp; --ignore "\*\*/node\_modules/\*\*,\*\*/dist/\*\*,\*\*/.\*/\*\*"



