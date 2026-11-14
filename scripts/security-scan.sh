#!/usr/bin/env bash
# Secret + dependency scan. Run from the repo root: bash scripts/security-scan.sh
fail=0
echo "== 1. secret patterns in source (node_modules, dist, .env excluded)"
if grep -rnIE --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude='.env' --exclude='security-scan.sh' --exclude='package-lock.json' \
  -e 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' -e 'sk-[A-Za-z0-9]{20,}' -e 'AKIA[0-9A-Z]{16}' -e 'gh[pousr]_[A-Za-z0-9]{30,}' \
  -e '(CLIENT_SECRET|APP_SECRET|SERVICE_ROLE_KEY|TOKEN_ENCRYPTION_KEY)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/_=-]{12,}["'"'"']' . ; then echo "FOUND possible secrets above"; fail=1; else echo "none found"; fi
echo "== 2. .env files must not be tracked"
grep -q '^\.env$' .gitignore && echo ".env is gitignored" || { echo ".env is NOT gitignored"; fail=1; }
find . -name '.env' -not -path './node_modules/*' | grep -q . && echo "note: a local .env exists (fine locally, never commit or zip it)"
echo "== 3. server keys must never reach the browser bundle"
if [ -d apps/web/dist ]; then
  if grep -rIlE 'service_role|SERVICE_ROLE|TOKEN_ENCRYPTION|CLIENT_SECRET|META_APP_SECRET' apps/web/dist apps/web/src; then echo "FOUND server key names in web code"; fail=1; else echo "web bundle and source are clean"; fi
else echo "build the web app first (npm run build --workspace web)"; fail=1; fi
echo "== 4. .env.example secrets are empty"
grep -nE '(SECRET|KEY)="[^"]+"' apps/api/.env.example | grep -vE 'KEY=""|SECRET=""|TOKEN_ENCRYPTION_KEY=""' && { echo "non-empty secret in .env.example"; fail=1; } || echo "ok"
echo "== 5. dependency audit (production dependencies; fails on high/critical except the accepted list below)"
# ACCEPTED: deepmerge-ts / @prisma/config / prisma (GHSA-ggr8-5vv4-36mx). It is in Prisma's config loader, which never receives user input;
# the fix is Prisma 7 (breaking change). Next step: migrate to Prisma 7. Review this list whenever you run the scan.
npm audit --omit=dev --json > /tmp/audit.json 2>/dev/null
node -e '
const a = JSON.parse(require("fs").readFileSync("/tmp/audit.json","utf8")).vulnerabilities || {};
const accepted = new Set(["deepmerge-ts","@prisma/config","prisma","@prisma/client"]);
const bad = Object.entries(a).filter(([n,v]) => ["high","critical"].includes(v.severity) && !accepted.has(n));
const acc = Object.entries(a).filter(([n,v]) => ["high","critical"].includes(v.severity) && accepted.has(n)).map(([n])=>n);
console.log("accepted (documented):", acc.join(", ") || "none");
if (bad.length) { console.log("NEW high/critical:", bad.map(([n,v])=>n+" ("+v.severity+")").join(", ")); process.exit(1); }
console.log("no other high/critical vulnerabilities");
' || fail=1
exit $fail
