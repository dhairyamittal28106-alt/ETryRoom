import {skinColour,skinTexture} from './exposed-legs.js';

// Reconstruct only the part of the old upper garment visible around the fitted top.
export function replaceOldTop(layer,frame,fit,old){
  const tone=skinColour(old.skin);
  if(!old.upper || !tone)return;
  const texture=old.outline?.texture || skinTexture(old.skin);
  const shirt=old.upper,b=shirt.sourceBounds,sx=frame.width/b.fullWidth,sy=frame.height/b.fullHeight;
  const l=Math.max(0,Math.floor(b.x*sx)),top=Math.max(0,Math.floor(b.y*sy));
  const w=Math.min(frame.width-l,Math.ceil(shirt.width*sx)),h=Math.min(frame.height-top,Math.ceil(shirt.height*sy));
  if(w<1||h<1)return;
  const patch=document.createElement('canvas');patch.width=w;patch.height=h;
  const ctx=patch.getContext('2d');ctx.drawImage(shirt,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h),rgba=pixels.data;
  const cloth=layer.getImageData(l,top,w,h).data;
  const original=frame.getContext('2d').getImageData(0,0,frame.width,frame.height).data;
  const span=fit.shoulderWidth;
  const joint=(side,name)=>[fit[side+name+'X'],fit[side+name+'Y']];
  const arms=['left','right'].flatMap(side=>{
    const pts=['Shoulder','Elbow','Wrist'].map(name=>joint(side,name));
    return [[pts[0],pts[1],.19,.132],[pts[1],pts[2],.138,.088]].filter(([a,b])=>[...a,...b].every(Number.isFinite));
  });
  const shoulderY=(fit.leftShoulderY+fit.rightShoulderY)/2,hipY=(fit.leftHipY+fit.rightHipY)/2;
  for(let row=0;row<h;row++){
    const y=top+row,t=(y-shoulderY)/Math.max(1,hipY-shoulderY);
    let first=w,last=-1;
    for(let x=0;x<w;x++)if(rgba[(row*w+x)*4+3]>90){first=Math.min(first,x);last=x;}
    const progress=Math.max(0,Math.min(1,t));
    const center=((fit.leftShoulderX+fit.rightShoulderX)*(1-progress)+(fit.leftHipX+fit.rightHipX)*progress)/2;
    const neck=Math.max(0,Math.min(1,(t+.19)/.22));
    const radius=span*(t<0?.19+.36*neck:.55-.09*Math.min(1,t));
    for(let x=first;x<=last;x++){
      const i=(row*w+x)*4;
      if(!rgba[i+3] || cloth[i+3]>250){rgba[i+3]=0;continue;}
      const px=l+x;
      let distance=t<-.27?2:Math.abs(px-center)/radius;
      for(const [a,b,r0,r1] of arms){
        const dx=b[0]-a[0],dy=b[1]-a[1];
        const u=Math.max(0,Math.min(1,((px-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
        distance=Math.min(distance,Math.hypot(px-a[0]-dx*u,y-a[1]-dy*u)/(span*(r0+(r1-r0)*u)));
      }
      const blend=Math.max(0,Math.min(1,(1-distance)*span*.15+.5));
      const bx=Math.max(0,Math.min(frame.width-1,l+(px<center?first-3:last+3)));
      const bg=(y*frame.width+bx)*4;
      const shade=.83+.18*Math.sqrt(Math.max(0,1-distance*distance));
      for(let c=0;c<3;c++)rgba[i+c]=tone[c]*shade*(texture?.(px,y) ?? 1)*blend+original[bg+c]*(1-blend);
    }
  }
  ctx.putImageData(pixels,0,0);
  layer.save();layer.globalCompositeOperation='destination-over';layer.drawImage(patch,l,top);layer.restore();
}

// Transfer the photographed forearm's light and contours when a rolled sleeve
// exposes it. Existing hands and pixels outside the old shirt are preserved.
export function fitForearms(layer,parts,landmarks,fit,old,frame){
  const tone=skinColour(old.skin);
  if(!tone || !old.upper || !landmarks)return;
  const result=document.createElement('canvas');
  result.width=frame.width;result.height=frame.height;
  const ctx=result.getContext('2d');
  for(const arm of parts.arms || []){
    if(!arm)continue;
    const b=arm.sourceBounds;
    const at=i=>({x:landmarks[i].x*b.fullWidth,y:landmarks[i].y*b.fullHeight});
    const cx=b.x+arm.width/2,cy=b.y+arm.height/2;
    const distance=k=>{const a=at(13+k),z=at(15+k);return Math.hypot(cx-(a.x+z.x)/2,cy-(a.y+z.y)/2);};
    const k=distance(0)<distance(1)?0:1;
    if(Math.min(landmarks[13+k].visibility,landmarks[15+k].visibility)<.5)continue;
    const side=at(11+k).x<at(12-k).x?'left':'right';
    const a=at(13+k),z=at(15+k),tx=fit[side+'ElbowX'],ty=fit[side+'ElbowY'];
    const dx=fit[side+'WristX']-tx,dy=fit[side+'WristY']-ty;
    const len=Math.hypot(z.x-a.x,z.y-a.y),target=Math.hypot(dx,dy);
    if(!Number.isFinite(target) || len<4 || target<4)continue;
    const ac=arm.getContext('2d'),pix=ac.getImageData(0,0,arm.width,arm.height),rgba=pix.data;
    const samples=[[],[],[]];
    for(let i=0;i<rgba.length;i+=16)if(rgba[i+3]>220)for(let c=0;c<3;c++)samples[c].push(rgba[i+c]);
    if(!samples[0].length)continue;
    const med=samples.map(v=>v.sort((a,b)=>a-b)[v.length>>1]);
    for(let i=0;i<rgba.length;i+=4)for(let c=0;c<3;c++)rgba[i+c]=tone[c]*(rgba[i+c]+12)/(med[c]+12);
    ac.putImageData(pix,0,0);
    ctx.save();ctx.translate(tx,ty);ctx.rotate(Math.atan2(dy,dx));
    ctx.beginPath();ctx.rect(-target*.3,-target*.5,target*1.33,target);ctx.clip();
    ctx.scale(target/len,fit.shoulderWidth/Math.max(1,Math.hypot(at(11).x-at(12).x,at(11).y-at(12).y)));
    ctx.rotate(-Math.atan2(z.y-a.y,z.x-a.x));ctx.drawImage(arm,b.x-a.x,b.y-a.y);ctx.restore();
  }
  const b=old.upper.sourceBounds,sx=frame.width/b.fullWidth,sy=frame.height/b.fullHeight;
  ctx.globalCompositeOperation='destination-in';
  ctx.drawImage(old.upper,b.x*sx,b.y*sy,old.upper.width*sx,old.upper.height*sy);
  layer.save();layer.globalCompositeOperation='destination-over';layer.drawImage(result,0,0);layer.restore();
}
