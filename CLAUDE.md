# Trips — Claude Instructions

## Pull Requests

After every approved plan or code change, always create a new PR without being asked. Each distinct change gets its own branch and PR.

After creating a PR, update `window.BUILD_INFO = { prNumber: ... }` in `index.html` (line ~1736) with the new PR number. This is displayed on the app's admin settings page so it's easy to confirm which PR is deployed.
