/* Berean GitHub Pages — dynamic release loader */

const REPO = 'RoyalWeden/Berean'
const API  = `https://api.github.com/repos/${REPO}/releases`

async function loadReleases() {
  const grid      = document.getElementById('download-grid')
  const noteEl    = document.getElementById('download-note')
  const betaSec   = document.getElementById('beta-section')
  const betaGrid  = document.getElementById('beta-grid')

  try {
    const res = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' }
    })

    if (res.status === 403 || res.status === 429) {
      showFallback(grid)
      return
    }

    if (!res.ok) throw new Error(`GitHub API: ${res.status}`)

    const releases = await res.json()

    // Only consider app releases (tag like v1.2.3) — excludes the data-v1
    // bundle release that hosts the database assets for CI.
    const appReleases = releases.filter(r => /^v\d/.test(r.tag_name))

    // Separate stable and pre-release
    const stable = appReleases.find(r => !r.prerelease && !r.draft)
    const beta   = appReleases.find(r =>  r.prerelease && !r.draft)

    if (!stable) {
      showFallback(grid)
      return
    }

    // Render stable download cards
    grid.innerHTML = ''
    grid.appendChild(buildCard('macos', stable))
    grid.appendChild(buildCard('windows', stable))

    noteEl.textContent = `Latest stable: ${stable.tag_name} — released ${formatDate(stable.published_at)}`

    // Render beta section if a pre-release exists
    if (beta) {
      betaGrid.innerHTML = ''
      betaGrid.appendChild(buildCard('macos', beta, true))
      betaGrid.appendChild(buildCard('windows', beta, true))
      betaSec.style.display = 'block'
    }

  } catch (err) {
    console.warn('Release fetch failed:', err)
    showFallback(grid)
  }
}

function buildCard(platform, release, isBeta = false) {
  const assets = release.assets || []

  // Mac: prefer arm64 DMG, fall back to any DMG
  // Win: prefer x64 Setup.exe, fall back to any Setup.exe
  let asset
  if (platform === 'macos') {
    asset = assets.find(a => a.name.endsWith('-arm64.dmg'))
         || assets.find(a => a.name.endsWith('.dmg'))
  } else {
    asset = assets.find(a => a.name.match(/Setup.*x64.*\.exe/i))
         || assets.find(a => a.name.endsWith('.exe'))
  }

  const isMac = platform === 'macos'
  const icon = isMac ? '🍎' : '🪟'
  const label = isMac ? 'macOS' : 'Windows'
  const arch  = isMac ? 'Apple Silicon (M-series)' : 'x64 / ARM64'

  const card = document.createElement('div')
  card.className = 'download-card'

  const platformRow = document.createElement('div')
  platformRow.className = 'dl-platform'
  platformRow.innerHTML = `<span class="dl-platform-icon">${icon}</span>${label}`

  const btn = document.createElement('a')
  btn.className = 'dl-btn'

  if (asset) {
    btn.href = asset.browser_download_url
    btn.textContent = `Download ${release.tag_name}`
    if (isBeta) btn.textContent += ' (beta)'
  } else {
    // No matching asset yet — link to the release page
    btn.href = release.html_url
    btn.target = '_blank'
    btn.rel = 'noopener'
    btn.textContent = 'View release →'
  }

  const meta = document.createElement('div')
  meta.className = 'dl-meta'
  const size = asset ? ` · ${formatBytes(asset.size)}` : ''
  meta.textContent = arch + size

  card.appendChild(platformRow)
  card.appendChild(btn)
  card.appendChild(meta)
  return card
}

function showFallback(grid) {
  grid.innerHTML = `
    <div class="release-error" style="grid-column:1/-1">
      Could not load release data from GitHub.
      <a href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">
        Browse releases on GitHub →
      </a>
    </div>`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatBytes(bytes) {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

// Beta section toggle
window.toggleBeta = function () {
  const content = document.getElementById('beta-content')
  const toggle  = document.getElementById('beta-toggle')
  const open = content.style.display === 'none'
  content.style.display = open ? 'block' : 'none'
  toggle.textContent = (open ? '▾' : '▸') + ' Beta builds'
}

// Also create a privacy.html redirect for the nav link
loadReleases()
