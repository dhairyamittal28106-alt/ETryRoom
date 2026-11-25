const MAX_IMAGE_DATA_LENGTH = 7_000_000;

async function toJpeg(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', {alpha: false});
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.86);
  if (jpeg.length > MAX_IMAGE_DATA_LENGTH) throw new Error('This image is too large after conversion.');
  return jpeg;
}

async function importPending() {
  const params = new URLSearchParams(location.search);
  if (params.has('import_error')) {
    const {importError} = await chrome.storage.session.get('importError');
    alert(importError || 'Image unavailable. Upload a product photo instead.');
    return;
  }
  const id = params.get('import');
  if (!id) return;
  try {
    const pending = (await chrome.storage.session.get(id))[id];
    if (!pending) return;
    const data = await toJpeg(pending.data);
    await chrome.storage.session.remove(id);
    history.replaceState(null, '', location.pathname);
    window.postMessage({...pending, data, type:'ETRYROOM_IMPORT', requestId:id}, location.origin);
  } catch (error) { alert(error.message); }
}
if (document.documentElement.dataset.etryroomReady) importPending();
else window.addEventListener('message', function ready(event) {
  if (event.source !== window || event.data?.type !== 'ETRYROOM_READY') return;
  window.removeEventListener('message', ready);
  importPending();
});
