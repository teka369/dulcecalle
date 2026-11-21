#!/bin/bash
R=/workspace/deep-audit/qa/dulcecalle; L=/workspace/qa-plans/deep-audit/logs
run(){ n=$1; shift; s=$(date +%s); ( "$@" ) > $L/$n.log 2>&1; e=$?; echo "exit=$e secs=$(( $(date +%s)-s ))" >> $L/$n.log; echo "$n exit=$e" >> $L/summary.txt; }
cd $R
run fe-tsc npx tsc --noEmit
run fe-eslint npx eslint --max-warnings=0
run fe-vitest npx vitest run
cd $R/backend
run be-tsc npx tsc --noEmit
run be-eslint npm run lint
run be-build npm run build
run be-jest npx jest --runInBand --forceExit
cd $R
run fe-vitest-clientpg npx vitest run -c vitest.client-pg.config.ts
run fe-build npm run build
