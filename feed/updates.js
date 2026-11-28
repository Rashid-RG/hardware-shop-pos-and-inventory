const releaseTitle = document.querySelector('#release-title');
const releaseDetail = document.querySelector('#release-detail');

async function showReleaseStatus() {
  try {
    const response = await fetch('status.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Release status unavailable');
    const release = await response.json();
    if (release.channel !== 'production') throw new Error('Unexpected release channel');
    if (release.status === 'awaiting-signed-release') return;
    if (release.status !== 'published' || typeof release.version !== 'string' ||
        !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(release.version)) {
      throw new Error('Unexpected release status');
    }
    releaseTitle.textContent = 'Production release ' + release.version;
    releaseDetail.textContent = 'Check for this version in your desktop updater.';
    releaseTitle.closest('.release').dataset.released = 'true';
  } catch {
    releaseTitle.textContent = 'Release status unavailable';
    releaseDetail.textContent = 'Refresh the page to check again.';
  }
}

for (const link of document.querySelectorAll('[data-pilot-download]')) {
  if (Date.now() >= Date.parse(link.dataset.expires)) {
    link.href = document.querySelector('.build').href;
    link.firstChild.textContent = 'View build on GitHub ';
    link.removeAttribute('aria-label');
  }
}

showReleaseStatus();
