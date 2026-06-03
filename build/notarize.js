/**
 * afterSign hook — notarizes the macOS app bundle with Apple's notary service.
 *
 * Runs automatically after electron-builder code-signs the .app.
 * Skipped silently when APPLE_ID is not set (local unsigned builds).
 *
 * Required env vars (set as GitHub Secrets for CI):
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID               — 10-character Team ID from developer.apple.com/account
 */

const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') return

  // Skip if credentials aren't present (local builds, unsigned CI, etc.)
  if (!process.env.APPLE_ID) {
    console.log('  • notarize: APPLE_ID not set — skipping notarization')
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`  • notarize: submitting ${appName}.app to Apple notary service…`)
  console.log(`    Apple ID: ${process.env.APPLE_ID}`)
  console.log(`    Team ID:  ${process.env.APPLE_TEAM_ID}`)

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('  • notarize: ✓ notarization complete')
}
