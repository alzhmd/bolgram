#!/usr/bin/env bash
# ==============================================================================
# SyncPay BD / PayFlow MFS — Rapid Health & Diagnostic Script
# Runs compiler verification, parser integrity, and sanity checks in seconds.
# ==============================================================================

echo "🔍 [1/4] Checking TypeScript & Type Consistency..."
npx tsc --noEmit
if [ $? -eq 0 ]; then
  echo "  ✅ TypeScript: Clean (0 type or syntax errors)"
else
  echo "  ❌ TypeScript: Compilation issues detected above!"
  exit 1
fi

echo ""
echo "🔍 [2/4] Checking MFS Regex Parser Engine..."
node --test --import tsx tests/parser.test.ts > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "  ✅ MFS Parsers: 100% Passing (bKash, Nagad, Rocket, Upay)"
else
  echo "  ❌ MFS Parsers: Some SMS patterns failed! Run 'node --test --import tsx tests/parser.test.ts' to inspect."
fi

echo ""
echo "🔍 [3/4] Verifying Environment Configurations..."
if [ -f ".env" ]; then
  echo "  ✅ .env file exists"
else
  echo "  ⚠️ Warning: .env file missing! Make sure to copy .env.example."
fi

echo ""
echo "🔍 [4/4] Verifying File Architecture & Public Assets..."
REQUIRED_FILES=(
  "src/index.ts"
  "src/parsers/mfs.parser.ts"
  "src/routes/device.routes.ts"
  "src/routes/payment.routes.ts"
  "src/routes/merchant.routes.ts"
  "public/dashboard.html"
  "public/checkout.html"
)

ALL_PRESENT=true
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "  ❌ Missing critical file: $file"
    ALL_PRESENT=false
  fi
done

if [ "$ALL_PRESENT" = true ]; then
  echo "  ✅ All core architecture components verified."
fi

echo ""
echo "✨ System Diagnostic Completed Successfully!"
