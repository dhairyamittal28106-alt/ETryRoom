chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({windowId:tab.windowId});
});
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message.type==='picked' && sender.tab && /^(https?:|blob:|data:image\/)/i.test(message.url)) {
    if (message.openPanel) chrome.sidePanel.open({windowId:sender.tab.windowId});
    chrome.storage.session.set({['product-'+sender.tab.windowId]:{url:message.url,displayUrl:message.displayUrl || message.url,gallery:Array.isArray(message.gallery)?message.gallery.filter(url=>typeof url==='string' && /^https?:/.test(url)).slice(0,12):[],tabId:sender.tab.id,page:sender.tab.url,name:message.name,selectionId:crypto.randomUUID()}});
  }
});

// Capture only on a request from our panel for its currently selected product.
// Re-read the image bounds after the side panel changes the page layout.
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg.type!=='visible-product' || sender.url!==chrome.runtime.getURL('static/panel.html'))return;
  visibleProduct(msg.selectionId).then(data=>reply({data}),()=>reply({data:null}));
  return true;
});
async function visibleProduct(id){
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab)return null;
  const key='product-'+tab.windowId;
  const item=(await chrome.storage.session.get(key))[key];
  if(!item || item.selectionId!==id || tab.id!==item.tabId || tab.url!==item.page)return null;
  const [{result:r}]=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[item.displayUrl],func:url=>{
    for(const img of document.querySelectorAll('img,.image-grid-image,[style*=background-image]')){
      const src=img.currentSrc || img.src || getComputedStyle(img).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      if(src!==url)continue;
      // A same-origin or CORS-enabled image may already be decoded even if
      // downloading the URL again fails or the user has scrolled past it.
      if(img.complete && img.naturalWidth && img.naturalHeight){
        try{
          const canvas=document.createElement('canvas');
          const scale=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));
          canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
          canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
          return {data:canvas.toDataURL('image/png')};
        }catch{ /* Cross-origin pixels require the visible-tab fallback. */ }
      }
      const {x,y,width,height}=img.getBoundingClientRect();
      if(width<50 || height<50 || x<0 || y<0 || x+width>innerWidth || y+height>innerHeight)continue;
      if(!img.contains(document.elementFromPoint(x+width/2,y+height/2)))continue;
      return {x,y,width,height,vw:innerWidth,vh:innerHeight};
    }
  }});
  if(!r)return null;
  if(r.data)return r.data;
  const screenshot=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
  const [current]=await chrome.tabs.query({active:true,windowId:tab.windowId});
  if(current?.id!==tab.id || current.url!==item.page)return null;
  const source=await createImageBitmap(await (await fetch(screenshot)).blob());
  try{
    const sx=source.width/r.vw,sy=source.height/r.vh;
    const crop=new OffscreenCanvas(Math.max(1,Math.round(r.width*sx)),Math.max(1,Math.round(r.height*sy)));
    crop.getContext('2d').drawImage(source,r.x*sx,r.y*sy,r.width*sx,r.height*sy,0,0,crop.width,crop.height);
    const bytes=new Uint8Array(await (await crop.convertToBlob({type:'image/png'})).arrayBuffer());
    let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return 'data:image/png;base64,'+btoa(binary);
  }finally{source.close();}
}
