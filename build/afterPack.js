const { execSync, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return

  const plist = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist')
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "${plist}"`)
    console.log('  • afterPack: set LSMinimumSystemVersion to 12.0')
  } catch (e) {
    console.error('  • afterPack: failed to set LSMinimumSystemVersion', e.message)
  }

  // Declare no non-exempt encryption — bypasses the App Store Connect encryption
  // question and avoids the need for export compliance documentation.
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "${plist}" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "${plist}"`)
    console.log('  • afterPack: set ITSAppUsesNonExemptEncryption to false')
  } catch (e) {
    console.error('  • afterPack: failed to set ITSAppUsesNonExemptEncryption', e.message)
  }

  // Convert bundled SQLite databases from WAL to DELETE journal mode.
  // WAL-mode databases require a .db-shm shared-memory file in the SAME directory.
  // The app bundle is read-only in MAS, so SQLite fails with "unable to open database
  // file" when trying to create .db-shm. DELETE mode needs no auxiliary files.
  const dataDir = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'data')
  if (fs.existsSync(dataDir)) {
    const dbFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.db'))
    let converted = 0
    for (const dbFile of dbFiles) {
      const dbPath = path.join(dataDir, dbFile)
      if (fs.statSync(dbPath).size === 0) continue // skip empty placeholders
      try {
        execFileSync('sqlite3', [dbPath, 'PRAGMA journal_mode=DELETE;'])
        converted++
      } catch (e) {
        console.warn(`  • afterPack: ${dbFile}: could not convert journal_mode — ${e.message}`)
      }
    }
    console.log(`  • afterPack: converted ${converted}/${dbFiles.length} databases to DELETE journal mode`)
  }
}
