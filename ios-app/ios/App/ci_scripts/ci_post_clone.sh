#!/bin/sh
# Xcode Cloud: runs right after the repo is cloned, before Swift packages
# resolve. Does what `npm install` + `npx cap sync ios` do on the Mac.
set -eu

APP_DIR="$CI_PRIMARY_REPOSITORY_PATH/ios-app"
PROJECT="$APP_DIR/ios/App/App.xcodeproj"

# Node isn't on the Xcode Cloud image. The Capacitor plugins are Swift
# packages that live in node_modules, so npm has to run first.
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node

cd "$APP_DIR"
npm ci
npx cap sync ios

# The project doesn't commit a Team (each Mac picks its own), so take it from
# the workflow's TEAM_ID environment variable.
if ! grep -q "DEVELOPMENT_TEAM" "$PROJECT/project.pbxproj"; then
  if [ -z "${TEAM_ID:-}" ]; then
    echo "error: set TEAM_ID in the Xcode Cloud workflow's environment variables" >&2
    exit 1
  fi
  perl -pi -e "s/^(\s*)CODE_SIGN_STYLE = Automatic;/\$1CODE_SIGN_STYLE = Automatic;\n\$1DEVELOPMENT_TEAM = $TEAM_ID;/" "$PROJECT/project.pbxproj"
fi

# Xcode Cloud only uses package versions from a committed Package.resolved
# and won't resolve them itself, so say so plainly if it's missing.
if [ ! -f "$PROJECT/project.xcworkspace/xcshareddata/swiftpm/Package.resolved" ]; then
  echo "error: commit ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved (see IOS.md)" >&2
  exit 1
fi
