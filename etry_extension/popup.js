const statusLine = document.querySelector('#status');
document.querySelector('#open').onclick = () => chrome.tabs.create({url:chrome.runtime.getURL('static/index.html')});

async function showImages() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  const [result] = await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    func:() => [...document.images]
      .filter(img => img.naturalWidth >= 120 && img.naturalHeight >= 120 && /^https?:/.test(img.currentSrc))
      .map(img => ({src:img.currentSrc, label:img.alt, visible:img.getBoundingClientRect().bottom>0 && img.getBoundingClientRect().top<innerHeight}))
      .sort((a,b)=>Number(b.visible)-Number(a.visible))
      .filter((img,i,all)=>all.findIndex(other=>other.src===img.src)===i).slice(0,24)
  });
  const images = result.result;
  statusLine.textContent = images.length ? 'Choose a clothing photo to try on camera.' : 'Open a product page or upload a photo in your fitting room.';
  for (const [i,item] of images.entries()) {
    const button=document.createElement('button'), image=new Image();
    image.referrerPolicy='no-referrer';
    image.src=item.src;
    image.alt=item.label || 'Product photo '+(i+1);
    button.append(image);
    button.onclick=async () => {
      const url=new URL(item.src);
      const granted=await chrome.permissions.request({origins:[url.protocol+'//'+url.hostname+'/*']});
      if (!granted) { statusLine.textContent='Image access was declined. You can upload the photo instead.'; return; }
      await chrome.runtime.sendMessage({type:'TRY_IMAGE',tabId:tab.id,pageUrl:tab.url,src:item.src});
      statusLine.textContent='Opening your fitting room…';
    };
    document.querySelector('#pieces').append(button);
  }
}
showImages().catch(()=>{statusLine.textContent='Open a shopping page to pick a photo, or upload one in your fitting room.';});
