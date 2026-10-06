#!/bin/bash
echo "🔧 Fixing Flutter cache permissions..."
sudo chmod -R a+w /opt/homebrew/share/flutter/bin/cache/

echo "📦 Getting Flutter packages..."
cd /Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/flutter_agent
flutter pub get

echo "🔍 Analyzing code..."
flutter analyze --no-fatal-infos

echo "✅ Done! Now run: flutter run"
