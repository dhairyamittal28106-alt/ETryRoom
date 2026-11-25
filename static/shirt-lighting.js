/** Transfer broad light and shadow from the original shirt without copying its print. */
export function matchShirtLighting(ctx, shirt, frame, shoulderWidth){
  if(!shirt || !shirt.sourceBounds)return;
  const b=shirt.sourceBounds,sx=frame.width/b.fullWidth,sy=frame.height/b.fullHeight;
  const x=Math.max(0,Math.floor(b.x*sx)),y=Math.max(0,Math.floor(b.y*sy));
  const w=Math.min(frame.width-x,Math.ceil(shirt.width*sx)),h=Math.min(frame.height-y,Math.ceil(shirt.height*sy));
  if(w<4 || h<4)return;
  const lighting=document.createElement('canvas');lighting.width=w;lighting.height=h;
  const lc=lighting.getContext('2d');
  // Canvas blurs premultiplied pixels, so the RGB near the shirt edge is
  // normalized by its mask rather than mixed with the room background.
  lc.filter='blur('+Math.max(2,shoulderWidth*.07)+'px)';
  lc.drawImage(shirt,0,0,w,h);
  const light=lc.getImageData(0,0,w,h).data;
  const fabric=ctx.getImageData(x,y,w,h),dst=fabric.data;
  const luminance=i=>.2126*light[i]+.7152*light[i+1]+.0722*light[i+2];
  let sum=0,count=0;
  for(let i=0;i<light.length;i+=16){
    if(light[i+3]<210 || dst[i+3]<220)continue;
    sum+=Math.log(10+luminance(i));count++;
  }
  if(count<12)return;
  const mean=sum/count;
  for(let i=0;i<dst.length;i+=4){
    if(!dst[i+3])continue;
    const weight=light[i+3]/255;
    const gain=Math.exp(weight*Math.max(-.28,Math.min(.22,.48*(Math.log(10+luminance(i))-mean))));
    for(let k=0;k<3;k++)dst[i+k]*=gain;
  }
  ctx.putImageData(fabric,x,y);
}
