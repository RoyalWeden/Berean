const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return

  const plist = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist')
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "${plist}"`)
    console.log('  • afterPack: set LSMinimumSystemVersion to 12.0')
  } catch (e) {
    console.error('  • afterPack: failed to set LSMinimumSystemVersion', e.message)
  }
}
