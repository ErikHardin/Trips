#!/bin/sh
# Xcode Cloud: runs before each build. Sets Build on both targets (App and
# UpcomingWidget must match) to Xcode Cloud's own build number, so no one
# bumps it by hand.
set -eu

PBXPROJ="$CI_PRIMARY_REPOSITORY_PATH/ios-app/ios/App/App.xcodeproj/project.pbxproj"
sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/" "$PBXPROJ"
echo "Build number: $CI_BUILD_NUMBER"
