#!/bin/bash
cd /workspace/deep-audit/qa/dulcecalle; L=/workspace/qa-plans/deep-audit/logs
export NEXT_PUBLIC_API_URL=http://127.0.0.1:9/v1
s=$(date +%s); npm run build > $L/fe-build-deadapi.log 2>&1; echo "exit=$? secs=$(( $(date +%s)-s ))" >> $L/fe-build-deadapi.log
s=$(date +%s); E2E_PORT=3291 npx playwright test > $L/fe-playwright-full.log 2>&1; e=$?; echo "exit=$e secs=$(( $(date +%s)-s ))" >> $L/fe-playwright-full.log; echo "fe-playwright-full exit=$e" >> $L/summary.txt
s=$(date +%s); E2E_PORT=3292 npm run test:e2e:prod > $L/fe-playwright-prodcfg.log 2>&1; e=$?; echo "exit=$e secs=$(( $(date +%s)-s ))" >> $L/fe-playwright-prodcfg.log; echo "fe-playwright-prodcfg exit=$e" >> $L/summary.txt
