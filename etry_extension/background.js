const APP_URL = 'http://127.0.0.1:8000/';

function extractSizeChartFromPage() {
  const text = value => (value || '').replace(/\s+/g, ' ').trim();
  const numberPattern = /\d+(?:[.,]\d+)?/g;
  const chartLink = [...document.querySelectorAll('a[href]')].find(link => /size|sizing|fit.?guide/i.test(text(link.innerText || link.getAttribute('aria-label'))));
  for (const table of document.querySelectorAll('table')) {
    const rows = [...table.rows].map(row => [...row.cells].map(cell => text(cell.innerText || cell.textContent)));
    const headerIndex = rows.findIndex(row => row.some(cell => /size/i.test(cell)) && row.some(cell => /chest|bust/i.test(cell)));
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex], sizeColumn = headers.findIndex(cell => /size/i.test(cell));
    const tableContext = text(table.caption?.innerText || table.getAttribute('aria-label') || '');
    const chartContext = `${headers.join(' ')} ${tableContext}`.toLowerCase();
    const columns = [
      {key: 'chest', index: headers.findIndex(cell => /chest|bust/i.test(cell))},
      {key: 'waist', index: headers.findIndex(cell => /waist/i.test(cell))},
      {key: 'hip', index: headers.findIndex(cell => /hip|seat/i.test(cell))}
    ].filter(column => column.index >= 0);
    if (!columns.some(column => column.key === 'chest')) continue;
    const explicitBody = /\b(body measurements?|your measurements|wearer|to fit|fits chest|recommended body)\b/.test(chartContext);
    const explicitGarment = /\b(garment|finished product|product measurements|flat measurements|laid flat)\b/.test(chartContext);
    const hasRanges = rows.slice(headerIndex + 1).some(row => columns.some(column => [...(row[column.index] || '').matchAll(numberPattern)].length === 2));
    const body = explicitBody || (!explicitGarment && hasRanges);
    const parsed = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const label = text(row[sizeColumn]).replace(/[,\r\n]/g, ' ').slice(0, 24), chest = columns.find(column => column.key === 'chest');
      if (!label || !row[chest.index] || /^(size|chest|bust)$/i.test(label)) continue;
      const chestText = row[chest.index], chestValues = [...chestText.matchAll(numberPattern)].map(match => Number(match[0].replace(',', '.')));
      if (!chestValues.length || chestValues.length > 2) continue;
      const item = {label};
      let valid = true;
      for (const column of columns) {
        const raw = row[column.index] || '', values = [...raw.matchAll(numberPattern)].map(match => Number(match[0].replace(',', '.')));
        if (!values.length) {if (column.key === 'chest') valid = false;continue;}
        if (values.length > 2) {valid = false;break;}
        const heading = `${headers[column.index]} ${tableContext}`.toLowerCase(), unitContext = `${heading} ${raw.toLowerCase()}`;
        const inches = /\binches?\b|\(\s*in\.?\s*\)|(?:^|\s)in\.?\s*$/.test(unitContext), flat = /half|flat|width|pit.?to.?pit|\bp2p\b/.test(heading);
        const factor = (inches ? 2.54 : 1) * (!body && flat ? 2 : 1), cm = values.map(value => Math.round(value * factor * 10) / 10);
        if (cm.some(value => value < 40 || value > 220)) {valid = false;break;}
        if (body) {
          const low = cm[0], high = cm[1] ?? cm[0];
          if (low > high || low < 40 || high > 180) {valid = false;break;}
          item[`${column.key}_min_cm`] = low;item[`${column.key}_max_cm`] = high;
        } else {
          if (cm.length !== 1) {valid = false;break;}
          item[`${column.key}_cm`] = cm[0];
        }
      }
      if (valid) parsed.push({body,item});
    }
    if (parsed.length < 2 || parsed.some(entry => entry.body !== parsed[0].body)) continue;
    // Keep only dimensions present on every parsed size; never invent values for blank cells.
    const keep = ['waist', 'hip'].filter(name => parsed.every(entry => entry.item[`${name}${parsed[0].body ? '_min_cm' : '_cm'}`] != null));
    const sizes = parsed.map(({item}) => {
      const size = {label: item.label};
      if (parsed[0].body) {size.chest_min_cm = item.chest_min_cm;size.chest_max_cm = item.chest_max_cm;for (const name of keep) {size[`${name}_min_cm`] = item[`${name}_min_cm`];size[`${name}_max_cm`] = item[`${name}_max_cm`];}}
      else {size.chest_cm = item.chest_cm;for (const name of keep) size[`${name}_cm`] = item[`${name}_cm`];}
      return size;
    });
    return {basis: body ? 'body' : 'garment', basisConfidence: explicitBody || explicitGarment ? 'header' : hasRanges ? 'range' : 'default', sizes, sourceUrl: chartLink?.href || location.href};
  }
  return null;
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: 'etryroom-import',
    title: 'Try item + detect size chart in ETryRoom',
    contexts: ['image']
  }));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'etryroom-import' || !tab?.id || !info.srcUrl || !info.pageUrl) return;
  let imageUrl;
  try {
    imageUrl = new URL(info.srcUrl);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) return;
  } catch { return; }

  // Ask only for access to the image host the shopper just selected.
  const originPattern = `${imageUrl.protocol}//${imageUrl.hostname}/*`;
  chrome.permissions.request({origins: [originPattern]}, granted => {
    if (!granted) return;
    (async () => {
      let chart = null;
      try {
        const [page] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: extractSizeChartFromPage});
        chart = page?.result || null;
      } catch { /* Restricted or cross-origin pages still import the selected image. */ }
      const response = await fetch(info.srcUrl, {credentials: 'omit', redirect: 'follow'});
      if (!response.ok) throw new Error('The product image could not be downloaded.');
      const blob = await response.blob();
      const mime = blob.type.split(';')[0].toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || blob.size > 5 * 1024 * 1024) {
        throw new Error('Choose a PNG, JPG, or WebP image under 5 MB.');
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      const data = `data:${mime};base64,${btoa(binary)}`;
      await chrome.storage.session.set({pending: {
        data,
        name: tab.title?.trim().slice(0, 100) || 'Shopping find',
        sourceUrl: info.pageUrl,
        chart
      }});
      await chrome.tabs.create({url: `${APP_URL}?import=1`});
    })().catch(async error => {
      await chrome.storage.session.set({importError: error.message || 'Product image import failed.'});
      await chrome.tabs.create({url: `${APP_URL}?import_error=1`});
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'ETRYROOM_GET_PENDING') {
    chrome.storage.session.get(['pending', 'importError']).then(reply);
    return true;
  }
  if (message?.type === 'ETRYROOM_CLEAR_PENDING') {
    chrome.storage.session.remove(['pending', 'importError']).then(() => reply({ok: true}));
    return true;
  }
});
