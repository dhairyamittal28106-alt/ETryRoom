/** Isolate the largest contiguous colour variant on a solid-colour multipack.
 * Segment on a small grid, then copy the original texture at source resolution.
 */
export function frontVariant(image) {
  const grid=document.createElement('canvas');
  const scale=Math.min(1,240/Math.max(image.width,image.height));
  const w=grid.width=Math.max(1,Math.round(image.width*scale));
  const h=grid.height=Math.max(1,Math.round(image.height*scale));
  const ctx=grid.getContext('2d');ctx.drawImage(image,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h).data;
  const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let best=[], total=0;
  for(let i=0;i<w*h;i++)if(data[4*i+3]>140)total++;
  function colour(i){
    const k=i*4,r=data[k],g=data[k+1],b=data[k+2],sum=r+g+b+40;
    return [(r-g)/sum,(b-g)/sum,(r+g+b)/765];
  }
  for(let i=0;i<w*h;i++){
    if(visited[i] || data[i*4+3]<141)continue;
    const seed=colour(i);
    let end=1;queue[0]=i;visited[i]=1;
    function add(n){
      if(visited[n] || data[n*4+3]<141)return;
      const c=colour(n);
      if(Math.hypot(c[0]-seed[0],c[1]-seed[1])>.17 || Math.abs(c[2]-seed[2])>.38)return;
      visited[n]=1;queue[end++]=n;
    }
    for(let j=0;j<end;j++){
      const n=queue[j],x=n%w;
      if(x)add(n-1);if(x+1<w)add(n+1);if(n>=w)add(n-w);if(n+w<w*h)add(n+w);
    }
    if(end>best.length)best=queue.slice(0,end);
  }
  if(best.length<total*.26 || !best.length)return null;
  const mask=ctx.createImageData(w,h);
  let left=w,right=0,top=h,bottom=0;
  for(const n of best){
    mask.data[n*4+3]=255;left=Math.min(left,n%w);right=Math.max(right,n%w);
    top=Math.min(top,Math.floor(n/w));bottom=Math.max(bottom,Math.floor(n/w));
  }
  ctx.putImageData(mask,0,0);
  const out=document.createElement('canvas');
  const sx=image.width/w,sy=image.height/h;
  out.width=Math.ceil((right-left+1)*sx);out.height=Math.ceil((bottom-top+1)*sy);
  const dest=out.getContext('2d');dest.drawImage(image,-left*sx,-top*sy);
  dest.globalCompositeOperation='destination-in';
  dest.drawImage(grid,-left*sx,-top*sy,image.width,image.height);
  return out;
}
