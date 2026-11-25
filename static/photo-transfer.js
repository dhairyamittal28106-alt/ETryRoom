import {repairShirt} from './repair-shirt.js';
import {point} from './garment-renderer.js';

// Transform a source bone and its perpendicular into the wearer's coordinate system.
function place(ctx, layer, a, b, c, d, widthScale) {
  const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
  const tx=d.x-c.x, ty=d.y-c.y, target=Math.hypot(tx,ty);
  if(length<2 || target<2)return;
  const ux=dx/length, uy=dy/length;
  const m11=tx/length*ux+ty/target*widthScale*uy;
  const m12=ty/length*ux-tx/target*widthScale*uy;
  const m21=tx/length*uy-ty/target*widthScale*ux;
  const m22=ty/length*uy+tx/target*widthScale*ux;
  ctx.save();
  ctx.transform(m11,m12,m21,m22,c.x-m11*a.x-m21*a.y,c.y-m12*a.x-m22*a.y);
  ctx.drawImage(layer,0,0);ctx.restore();
}
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

export function transferShirt(ctx, shirt, landmarks, crop, fit, regularShirt=false, exposedArms=[]) {
  if(!landmarks || ![11,12,23,24].every(i=>landmarks[i]?.visibility>.35))return false;
  const p=i=>({x:landmarks[i].x*crop.fullWidth-crop.x,y:landmarks[i].y*crop.fullHeight-crop.y});
  const order=p(11).x<p(12).x?[0,1]:[1,0];
  const shoulder=order.map(i=>p(11+i)), hip=order.map(i=>p(23+i));
  const span=Math.hypot(shoulder[1].x-shoulder[0].x,shoulder[1].y-shoulder[0].y);
  if(span<shirt.width*.23 || span>shirt.width*1.2)return false;
  const top=mid(...shoulder),bottom=mid(...hip);
  if(bottom.y-top.y<span*.45)return false;
  const target=(joint)=>['left','right'].map(side=>point(fit,side,joint));
  const scale=fit.shoulderWidth/span;
  const bones=[{a:top,b:bottom,c:mid(...target('Shoulder')),d:mid(...target('Hip'))}];
  for(const [side,i] of order.entries()){
    const joints=[shoulder[side],p(13+i),p(15+i)];
    const targets=['Shoulder','Elbow','Wrist'].map(j=>target(j)[side]);
    const forearm=mid(joints[1],joints[2]);
    const bare=exposedArms.some(arm=>{
      if(!arm)return false;
      const x=Math.round(forearm.x+crop.x-arm.sourceBounds.x),y=Math.round(forearm.y+crop.y-arm.sourceBounds.y);
      return x>=0 && x<arm.width && y>=0 && y<arm.height && arm.getContext('2d').getImageData(x,y,1,1).data[3]>150;
    });
    for(let k=0;k<(bare?1:2);k++){
      if(!targets[k]||!targets[k+1]||landmarks[(k?15:13)+i].visibility<.35 || (k && landmarks[13+i].visibility<.35))continue;
      bones.push({bare,a:joints[k],b:joints[k+1],c:targets[k],d:targets[k+1]});
    }
  }
  const pixels=shirt.getContext('2d').getImageData(0,0,shirt.width,shirt.height);
  const layers=bones.map(()=>new ImageData(shirt.width,shirt.height));
  const src=new Uint32Array(pixels.data.buffer), buffers=layers.map(l=>new Uint32Array(l.data.buffer));
  // Keep the chest, placket and collar together. Only pixels near an arm outside
  // the torso core follow the sleeve. Transparent cutouts preserve rolled cuffs.
  for(let i=0;i<src.length;i++){
    if(!pixels.data[i*4+3])continue;
    const x=i%shirt.width,y=Math.floor(i/shirt.width);
    const t=Math.max(0,Math.min(1,(y-top.y)/(bottom.y-top.y)));
    const center=top.x+(bottom.x-top.x)*t;
    let owner=0,best=(span*.23)**2;
    const aboveCollar=y<top.y-span*.24;
    if(aboveCollar || Math.abs(x-center)>span*(.39+.04*t)){
      for(let j=1;j<bones.length;j++){
        const {a,b}=bones[j],dx=b.x-a.x,dy=b.y-a.y;
        const u=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
        if(bones[j].bare && u>.84)continue;
        const distance=(x-a.x-u*dx)**2+(y-a.y-u*dy)**2;
        if(distance<best){best=distance;owner=j;}
      }
    }
    // Fabric above the collar belongs to the lifted arm. If its bone
    // is unavailable, keep that disconnected cuff off the torso.
    if(aboveCollar && owner===0)continue;
    buffers[owner][i]=src[i];
    // Small overlap at sleeve caps prevents a seam opening on mild pose changes.
    if(owner && !aboveCollar && Math.abs(x-center)<span*.45)buffers[0][i]=src[i];
  }
  const layer=document.createElement('canvas');layer.width=shirt.width;layer.height=shirt.height;
  for(const index of [...bones.keys()].slice(1).concat(0)){
    layer.getContext('2d').putImageData(layers[index],0,0);
    // Moving sleeves can expose fresh gaps in a previously intact source mask.
    if(index===0)repairShirt(layer);
    const bone=bones[index];
    if(index===0 && regularShirt && fitTorso(ctx,layer,bone,span,scale,fit))continue;
    place(ctx,layer,bone.a,bone.b,bone.c,bone.d,scale);
  }
  return true;
}

// A raised arm or cropped catalogue photo can leave the source hip estimate
// below the actual shirt. Measure the connected front panel before mapping it.
function fitTorso(ctx,layer,bone,span,scale,fit){
  const {a,b,c,d}=bone,w=layer.width,h=layer.height;
  const canvas=layer.getContext('2d'),rgba=canvas.getImageData(0,0,w,h).data;
  const covered=(x,y)=>rgba[(y*w+x)*4+3]>110;
  const centerAt=y=>a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y);
  const start=Math.max(0,Math.ceil(a.y+span*.28));
  let hem=-1,missing=0;
  const widths=[];
  for(let y=start;y<h;y++){
    const mid=Math.round(centerAt(y)),radius=Math.max(2,Math.round(span*.24));
    let count=0;
    for(let x=Math.max(0,mid-radius);x<=Math.min(w-1,mid+radius);x++) if(covered(x,y))count++;
    if(count<radius*1.25){
      if(hem>=0 && ++missing>Math.max(2,span*.04))break;
      continue;
    }
    hem=y;missing=0;
    if(y<a.y+span*.85 && mid>=0 && mid<w && covered(mid,y)){
      let l=mid,r=mid;
      while(l>0 && covered(l-1,y))l--;
      while(r+1<w && covered(r+1,y))r++;
      widths.push(r-l+1);
    }
  }
  if(hem-a.y<span*.65 || !widths.length)return false;
  const width=widths.sort((l,r)=>l-r)[widths.length>>1];
  const cross=fit.chestWidth && width>span*.65 ? Math.max(scale*.94,Math.min(scale*1.18,fit.chestWidth/width)) : scale;
  // Keep the shape of a curved hem while discarding isolated fabric below it.
  const end=Math.min(h,Math.ceil(hem+span*.065)+1);
  canvas.clearRect(0,end,w,h-end);
  place(ctx,layer,a,{x:centerAt(hem),y:hem},c,{x:c.x+(d.x-c.x)*1.1,y:c.y+(d.y-c.y)*1.1},cross);
  return true;
}
