(() => {
  const cards = '[data-component-type="s-search-result"],.s-result-item[data-asin],li.product,.product-card,[data-testid="product-card"],product-card,product-tile,[data-product-card],[itemtype$="/Product"]';
  const productLinks = 'a[href*="/p/itm"],a[href*="/product/"],a[href*="/products/"],a[href*="/dp/"]';
  const cartPattern = /add[\s_-]*(?:to[\s_-]*)?(?:shopping[\s_-]*)?(?:cart|bag|basket)/i;
  const pricePattern = /(?:[$\u20ac\u00a3\u20b9\u00a5]|\b(?:USD|EUR|GBP|INR|Rs\.?))\s*\d/i;
  const mounted = new Map();
  const actions = new WeakMap();

  window.addEventListener('click', event => {
    const button = event.composedPath().find(node => actions.has(node));
    if (!button || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const item = actions.get(button)();
    if (item) chrome.runtime.sendMessage({type:'picked',openPanel:true,...item});
  }, true);

  function imageIn(root) {
    return [...root.querySelectorAll('img')].filter(img => img.clientWidth >= 65 && /^(https?:|blob:|data:image\/)/.test(img.currentSrc || img.src))
      .sort((a,b) => b.clientWidth*b.clientHeight - a.clientWidth*a.clientHeight)[0];
  }

  function product(root,img) {
    const displayUrl = mediaUrl(img);
    const heading=root.querySelector('.pdp-name,[data-testid="product-name"],#productTitle')?.textContent.trim();
    const fallback=root.querySelector('h1,h2,h3,[data-cy=title-recipe] a');
    const name=heading || [fallback?.textContent.trim(),img.alt].filter(Boolean).sort((a,b)=>b.length-a.length)[0] || document.title;
    const group=img.closest('.woocommerce-product-gallery,media-gallery,[data-product-gallery],.product-gallery,.product__media-list');
    let views=[];
    if(img.matches('.image-grid-image'))views=root.querySelectorAll('.image-grid-image');
    else if(group)views=group.querySelectorAll('img');
    else if(img.id==='landingImage')views=root.querySelectorAll('#altImages li.imageThumbnail img');
    else if(root!==document)views=[img,...root.querySelectorAll('[data-product-image],img.product-image')].filter(node=>node.tagName==='IMG');
    const ranked=[...views].filter(node=>!node.closest('[class*="swatch" i],[class*="recommend" i],video') &&
      (node===img || !node.closest('a[href]') || !img.closest('a[href]') || node.closest('a[href]').pathname===img.closest('a[href]').pathname))
      .map(node=>{
        const label=node.alt || node.getAttribute('aria-label') || '';
        const score=/\b(front|full[- ]length)\b/i.test(label)?2:/\b(detail|close[- ]?up|rear|back view)\b/i.test(label)?-1:0;
        return {url:node.getAttribute('data-large_image') || mediaUrl(node),score};
      }).filter(view=>/^https?:/.test(view.url)).sort((a,b)=>b.score-a.score);
    const gallery=[...new Set(ranked.map(view=>view.url))].slice(0,12);
    return {url:(img.matches('.image-grid-image') || group) && gallery[0] || displayUrl,displayUrl,name,gallery};
  }

  function isCart(node) {
    if ([node.id,node.value,node.title,node.getAttribute('aria-label'),node.getAttribute('data-testid')].some(label => cartPattern.test(label || ''))) return true;
    if (node.matches('button,input,[role=button]') || !node.childElementCount) return cartPattern.test(node.textContent.trim().slice(0,120));
    return [...node.childNodes].some(child => child.nodeType===Node.TEXT_NODE && cartPattern.test(child.textContent));
  }

  function surface(node) {
    let control = node.closest('button,input,[role=button],[onclick],[tabindex="0"],a[href]:not(:has(img))') || node;
    // A text label can be several layers inside a painted, clickable div.
    for(let parent=control.parentElement; parent && !parent.matches('form,body,main,article,li,[data-etry-row]'); parent=parent.parentElement){
      if(parent.matches(cards) || parent.textContent.trim()!==control.textContent.trim() || imageIn(parent)) break;
      const css=getComputedStyle(parent);
      if(css.cursor==='pointer' || css.borderTopStyle!=='none' || css.backgroundColor!=='rgba(0, 0, 0, 0)') control=parent;
    }
    return control.closest('.a-button') || control;
  }

  function place(anchor,getItem,cart,seen) {
    seen.add(anchor);
    let button=mounted.get(anchor);
    if(!button){
      button=document.createElement('button');
      button.type='button';
      button.dataset.etryTryNow='';
      button.textContent='Try now';
      button.style.cssText='all:initial;box-sizing:border-box;display:inline-block;flex:0 0 auto;align-self:center;white-space:nowrap;padding:6px 12px;border:1px solid #28513d;border-radius:20px;background:white;color:#244438;font:600 14px system-ui;cursor:pointer';
      mounted.set(anchor,button);
    }
    if(cart && !anchor.parentElement.hasAttribute('data-etry-row')){
      const row=document.createElement('div');
      row.dataset.etryRow='';
      row.style.cssText='box-sizing:border-box;display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;flex:1 1 auto';
      anchor.before(row);
      row.append(anchor);
    }
    actions.set(button,getItem);
    if(anchor.nextElementSibling!==button) anchor.after(button);
  }

  function mediaUrl(node){
    if(node.tagName==='IMG')return node.currentSrc || node.src;
    return getComputedStyle(node).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  }
  function displayedImage(root, detailView=false){
    let best, bestScore=0;
    for(const img of root.querySelectorAll('img,.image-grid-image,[style*=background-image]')){
      if(!img.checkVisibility({opacityProperty:true,visibilityProperty:true}) || img.closest('[aria-hidden="true"],[inert]')) continue;
      if(detailView && img.closest('aside,nav,header,footer,'+cards) && !img.closest('[itemtype$="/Product"]')?.querySelector('h1')) continue;
      const rect=img.getBoundingClientRect();
      if(rect.width<65 || rect.height<60 || !mediaUrl(img)) continue;
      const left=Math.max(0,rect.left), top=Math.max(0,rect.top);
      const width=Math.max(0,Math.min(innerWidth,rect.right)-left);
      const height=Math.max(0,Math.min(innerHeight,rect.bottom)-top);
      let score=rect.width*rect.height;
      if(width && height){
        const stack=document.elementsFromPoint(left+width/2,top+height/2);
        const front=stack.find(node=>node===img || node.tagName==='IMG');
        if(front && front!==img) continue;
        if(front===img) score+=width*height;
      }else score*=0.4;
      if(img.matches('#landingImage,[itemprop=image]') || img.closest('.woocommerce-product-gallery')) score*=1.5;
      if(score>bestScore){ best=img; bestScore=score; }
    }
    return best;
  }

  window.__etryProductForImage=img=>product(img.closest(cards) || document,img);
  function detail(cart){
    const local=cart.closest('article,li,'+cards);
    const root=local || document;
    const hero=root.querySelector('.image-grid-image');
    if(hero && mediaUrl(hero))return product(root,hero);
    const img=displayedImage(root,!local) || displayedImage(root);
    if(img) return product(root,img);
    const url=document.querySelector('meta[property="og:image"]')?.content;
    return url && {url:new URL(url,document.baseURI).href,name:document.title};
  }

  function scan(){
    const seen=new Set(), carts=new Set(),tiles=new Map();
    for(const node of document.querySelectorAll('button,input,a,[role=button],[aria-label],[title],[data-testid],div,span')){
      if(!node.hasAttribute('data-etry-row') && isCart(node) && node.getClientRects().length) carts.add(surface(node));
    }
    for(const card of document.querySelectorAll(cards)){
      const img=imageIn(card);
      if(img && !card.querySelector(cards)) tiles.set(card,img);
    }
    for(const img of document.querySelectorAll('a[href] img')){
      const link=img.closest('a');
      if(img.clientWidth<65 || link.closest(cards)) continue;
      let tile=link;
      for(let parent=link.parentElement;parent && !parent.matches('body,main,section,nav,footer,header');parent=parent.parentElement){
        if(parent.querySelector('h1') || [...parent.querySelectorAll('a[href] img')].some(other=>other.closest('a').pathname!==link.pathname)) break;
        tile=parent;
        if(tile.matches('article,li') || [...carts].some(cart=>tile.contains(cart))) break;
      }
      if(tile.querySelector('h1') || tile.querySelectorAll('a[href] img').length>2) continue;
      if(link.matches(productLinks) && link.pathname!==location.pathname || pricePattern.test(tile.textContent)) tiles.set(tile,img);
    }
    for(const [tile,img] of tiles){
      const cart=[...carts].find(c=>tile.contains(c));
      if(cart) carts.delete(cart);
      place(cart || img.closest('a') || img,()=>product(tile,displayedImage(tile) || img),!!cart,seen);
    }
    for(const cart of carts) place(cart,()=>detail(cart),true,seen);
    for(const [anchor,button] of mounted){
      if(seen.has(anchor)) continue;
      const row=button.parentElement;
      button.remove();
      if(row?.hasAttribute('data-etry-row')) row.replaceWith(...row.childNodes);
      mounted.delete(anchor);
    }
  }
  const style=document.createElement('style');
  style.textContent='[data-etry-row] > :first-child{flex:1 1 auto!important;min-width:0!important;max-width:100%!important}';
  document.head.append(style);
  let timer;
  function schedule(){if(!timer) timer=setTimeout(()=>{timer=null;scan();},220);}
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','srcset','href','title','aria-label','value','data-testid']});
  window.addEventListener('load',schedule,true);
  schedule();
})();
