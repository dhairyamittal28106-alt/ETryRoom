/** Replace only trouser-mask pixels visible around the fitted lower garment. */
export function drawExposedLegs(ctx, frame, fit, outline, hem) {
  if (!outline?.skin) return;
  const {pants, skin, rows, top, sy} = outline;
  const bounds = pants.sourceBounds;
  const sx = frame.width / bounds.fullWidth;
  const matte = pants.getContext('2d').getImageData(0,0,pants.width,pants.height).data;
  const start = Math.max(0,Math.floor(top));
  const end = Math.min(frame.height,Math.ceil(top+pants.height*sy));
  if (end<=start) return;
  const original = frame.getContext('2d').getImageData(0,start,frame.width,end-start);
  const output = ctx.createImageData(original.width,original.height);
  const pixels=original.data, data=output.data, w=original.width;
  const span=fit.shoulderWidth;
  const hipY=(fit.leftHipY+fit.rightHipY)/2;
  const leftHip=[fit.leftHipX,fit.leftHipY],rightHip=[fit.rightHipX,fit.rightHipY];
  const axes=[['left',leftHip],['right',rightHip]].map(([side,hip])=>{
    const joint=(name,fallback)=>Number.isFinite(fit[side+name+'Y']) ? [fit[side+name+'X'],fit[side+name+'Y']] : fallback;
    const knee=joint('Knee',[hip[0],hip[1]+span*1.35]);
    const ankle=joint('Ankle',[knee[0],knee[1]+span*1.24]);
    return [hip,knee,ankle];
  });
  for(let y=start;y<end;y++){
    const row=Math.floor((y-top)/sy), edges=rows[row];
    if(!edges)continue;
    const [left,right]=edges;
    const centers=axes.map(([hip,knee,ankle])=>{
      const [a,b]=y<knee[1]?[hip,knee]:[knee,ankle];
      const t=Math.max(0,Math.min(1,(y-a[1])/Math.max(1,b[1]-a[1])));
      return a[0]+(b[0]-a[0])*t;
    });
    const split=Math.max(left,Math.min(right,(centers[0]+centers[1])/2));
    for(let x=Math.max(0,Math.ceil(left));x<Math.min(w,right);x++){
      const col=Math.floor(x/sx-bounds.x);
      if(col<0 || col>=pants.width)continue;
      const alpha=matte[(row*pants.width+col)*4+3];
      if(!alpha)continue;
      const side=x<split?0:1;
      const [hip,knee,ankle]=axes[side];
      const t=Math.max(0,Math.min(1,(y-hipY)/Math.max(1,knee[1]-hip[1])));
      const calf=Math.max(0,Math.min(1,(y-knee[1])/Math.max(1,ankle[1]-knee[1])));
      const radius=span*(.275-.108*t+.045*Math.sin(Math.PI*calf)-.07*calf);
      const lo=side?split:left,hi=side?right:split;
      const center=Math.max(lo,Math.min(hi,centers[side]*.55+(lo+hi)*.225));
      const u=(x-center)/Math.max(1,radius);
      const coverage=Math.max(0,Math.min(1,(1-Math.abs(u))*radius+0.5));
      const shadow=Number.isFinite(hem)?Math.max(0,1-Math.abs(y-hem)/(span*.09)):0;
      const texture=outline.texture?.(x,y) ?? 1;
      const shade=.78+.25*Math.sqrt(Math.max(0,1-u*u))-.055*u-.09*shadow;
      const dst=((y-start)*w+x)*4;
      // Continue the neighbouring scene through the sliver vacated by loose trousers.
      const bx=Math.max(0,Math.min(w-1,Math.round(side?right+3+(right-x)*.3:left-3-(x-left)*.3)));
      const bg=((y-start)*w+bx)*4;
      for(let c=0;c<3;c++) data[dst+c]=coverage*skin[c]*shade*texture+(1-coverage)*pixels[bg+c];
      data[dst+3]=alpha;
    }
  }
  // Composite behind both hems, including their antialiased edges.
  const patch=document.createElement('canvas');patch.width=w;patch.height=end-start;
  patch.getContext('2d').putImageData(output,0,0);
  ctx.save();ctx.globalCompositeOperation='destination-over';ctx.drawImage(patch,0,start);ctx.restore();
}

export function skinColour(face){
  if(!face)return null;
  const data=face.getContext('2d').getImageData(0,0,face.width,face.height).data;
  const samples=[];
  for(let y=Math.floor(face.height*.35);y<face.height*.78;y+=2){
    for(let x=Math.floor(face.width*.17);x<face.width*.83;x+=2){
      const i=(y*face.width+x)*4;
      if(data[i+3]>210)samples.push([data[i],data[i+1],data[i+2]]);
    }
  }
  if(!samples.length)return null;
  samples.sort((a,b)=>(a[0]+2*a[1]+a[2])-(b[0]+2*b[1]+b[2]));
  return samples[Math.floor(samples.length*.6)];
}

// Sample a cheek patch from the wearer's masked photo. Mirror the patch at
// its edges and retain local luminance variation without repeating facial features.
export function skinTexture(face){
  if(!face || face.width<8 || face.height<8)return null;
  const w=face.width,h=face.height,data=face.getContext('2d').getImageData(0,0,w,h).data;
  const lum=i=>(data[i]*.299+data[i+1]*.587+data[i+2]*.114);
  const size=Math.max(3,Math.floor(Math.min(w,h)*.17));
  let best;
  for(const fx of [.28,.68]){
    const x=Math.min(w-size,Math.floor(w*fx)),y=Math.min(h-size,Math.floor(h*.55));
    const values=[];
    for(let j=0;j<size;j++)for(let k=0;k<size;k++){
      const i=((y+j)*w+x+k)*4;
      if(data[i+3]>230)values.push(lum(i));
    }
    if(values.length<size*size*.85)continue;
    values.sort((a,b)=>a-b);
    const median=values[values.length>>1];
    if(!best || median>best.median)best={x,y,median};
  }
  if(!best || best.median<1)return null;
  const mirror=v=>{const n=Math.floor(v)%(2*size);return n<size?n:2*size-1-n;};
  return (x,y)=>{
    const i=((best.y+mirror(y))*w+best.x+mirror(x))*4;
    return data[i+3]>230?Math.max(.91,Math.min(1.09,1+.65*(lum(i)/best.median-1))):1;
  };
}
