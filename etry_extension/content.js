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
  try {
    const {pending, importError} = await chrome.runtime.sendMessage({type: 'ETRYROOM_GET_PENDING'});
    if (importError) throw new Error(importError);
    if (!pending?.data) return;
    const data = await toJpeg(pending.data);
    const requestId = crypto.randomUUID();
    const finish = event => {
      if (event.source !== window || event.origin !== location.origin ||
          event.data?.type !== 'ETRYROOM_IMPORTED' || event.data?.requestId !== requestId) return;
      window.removeEventListener('message', finish);
      chrome.runtime.sendMessage({type: 'ETRYROOM_CLEAR_PENDING'});
    };
    window.addEventListener('message', finish);
    window.postMessage({
      type: 'ETRYROOM_IMPORT',
      data,
      name: pending.name || 'Shopping find',
      sourceUrl: pending.sourceUrl || '',
      chart: pending.chart || null,
      requestId
    }, location.origin);
  } catch (error) {
    chrome.runtime.sendMessage({type: 'ETRYROOM_CLEAR_PENDING'});
    alert(error.message || 'Could not import this image. Try saving it and uploading it in ETryRoom.');
  }
}

if (location.pathname === '/' && new URLSearchParams(location.search).has('import')) {
  if (document.documentElement.dataset.etryroomReady === 'true') {
    importPending();
  } else {
    window.addEventListener('message', event => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'ETRYROOM_READY') {
        importPending();
      }
    }, {once: true});
  }
}
if (location.pathname === '/' && new URLSearchParams(location.search).has('import_error')) {
  chrome.runtime.sendMessage({type: 'ETRYROOM_GET_PENDING'}).then(async ({importError}) => {
    if (importError) alert(importError);
    await chrome.runtime.sendMessage({type: 'ETRYROOM_CLEAR_PENDING'});
  });
}
