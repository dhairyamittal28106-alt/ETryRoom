const patternCache=new WeakMap();
export function pattern(image,kind){
 if(patternCache.has(image))return patternCache.get(image);
 const c=document.createElement('canvas');c.width=256;c.height=320;
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,256,320);
 const rgba=ctx.getImageData(0,0,256,320).data;
 const solid=(x,y)=>rgba[(y*256+x)*4+3]>128;
 const spans=[];
 for(let y=0;y<320;y++){
  const runs=[];let start=-1;
  for(let x=0;x<=256;x++){
   if(x<256&&solid(x,y)){if(start<0)start=x;}
   else if(start>=0){if(x-start>3)runs.push([start,x]);start=-1;}
  }
  spans.push(runs);
 }
 // A split shirt hem can contain two separate tails. Estimate the torso
 // from several rows above the hem so neither tail becomes its center.
 const torsoRows=[];
 for(let y=170;y<=245;y+=5){
   const runs=spans[y];
   if(!runs.length)continue;
   const widest=runs.reduce((a,b)=>a[1]-a[0]>b[1]-b[0]?a:b);
   if(widest[1]-widest[0]>68)torsoRows.push(widest);
 }
 const median=values=>values.sort((a,b)=>a-b)[values.length>>1];
 const middle=torsoRows.length?median(torsoRows.map(([a,b])=>(a+b)/2)):128;
 const half=torsoRows.length?Math.max(42,Math.min(100,median(torsoRows.map(([a,b])=>(b-a)/2)))):80;
 const panel=()=>{const v=document.createElement('canvas');v.width=128;v.height=320;return v;};
 const body=panel(),sleeves=[panel(),panel()],legs=[panel(),panel()];
 const bodyCtx=body.getContext('2d');
 for(let y=0;y<320;y++){
  const span=spans[y].length?[spans[y][0][0],spans[y].at(-1)[1]]:[-1,-1];
  if(span[0]>=0){
   const x=Math.max(span[0],middle-half),right=Math.min(span[1],middle+half);
   if(right>x)bodyCtx.drawImage(c,x,y,right-x,1,(x-middle+half)*64/half,y,(right-x)*64/half,1);
  }
  for(let side=0;side<2;side++){
   const runs=spans[y];if(!runs.length)continue;
   let [lo,hi]=runs[side?runs.length-1:0];
   if(runs.length===1){const mid=(lo+hi)/2;if(side)lo=mid;else hi=mid;}
   legs[side].getContext('2d').drawImage(c,lo,y,hi-lo,1,0,y,128,1);
  }
 }
 const ends=[];
 for(let side=0;side<2;side++){
  const bounds=[];
  for(let x=12;x<51;x++){const col=side?255-x:x;let lo=0,hi=319;
   while(lo<hi&&!solid(col,lo))lo++;while(hi>lo&&!solid(col,hi))hi--;
   if(hi-lo>12)bounds.push([col,lo,hi]);}
  ends.push(bounds.length?bounds.map(v=>v[2]).sort((a,b)=>a-b)[bounds.length>>1]:140);
  const sc=sleeves[side].getContext('2d');
  for(let x=0;x<128&&bounds.length;x++){const [col,lo,hi]=bounds[Math.min(bounds.length-1,Math.floor(x*bounds.length/128))];// A bent source arm can leave background gaps in this column.
   const occupied=[];
   for(let y=lo;y<=hi;y++)if(solid(col,y))occupied.push(y);
   for(let y=0;y<320;y++){
    const sample=occupied[Math.floor(y*occupied.length/320)];
    sc.drawImage(c,col,sample,1,1,x,y,1,1);
   }}
 }
 // The outermost pixel can be a raised cuff, well above the actual collar.
 // Find the connected run of broad fabric through the middle of the torso.
 const torsoBand=bodyCtx.getImageData(0,0,128,320).data;
 const broadRow=y=>{
   let covered=0;
   for(let x=16;x<112;x++)if(torsoBand[(y*128+x)*4+3]>128)covered++;
   return covered>=56;
 };
 let first=180,last=180;
 if(broadRow(first)){
   while(first>0 && broadRow(first-1))first--;
   while(last<319 && broadRow(last+1))last++;
 }
 let front=body;
 if(first>28 && last-first>90){
   // Preserve the neckline above the first full chest row and the curved hem.
   const allowance=Math.round((last-first)*.09);
   const start=Math.max(0,first-allowance),end=Math.min(320,last+allowance+1);
   front=document.createElement('canvas');front.width=128;front.height=end-start;
   front.getContext('2d').drawImage(body,0,start,128,end-start,0,0,128,end-start);
 }
 const result={body:front,sleeves,legs,long:Math.max(...ends)>225};
 patternCache.set(image,result);return result;
}
export function point(fit,side,joint){
 const x=fit[side+joint+'X'],y=fit[side+joint+'Y'];
 return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
export function mixPoint(a,b,t){return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
export function segment(ctx,img,a,b,w0,w1,t0=0,t1=1){
 const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
 if(length<1)return;
 ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(-dx,dy));
 const rows=Math.min(90,Math.ceil(length));
 for(let i=0;i<rows;i++){const t=i/rows,width=w0+(w1-w0)*t;
  ctx.drawImage(img,0,img.height*(t0+(t1-t0)*t),img.width,img.height*(t1-t0)/rows,-width/2,length*t,width,length/rows+.65);}
 ctx.restore();
}
export function drawWarpedGarment(image,f,ctx,s){
 const cloth=pattern(image,'upper'),span=f.shoulderWidth;
 const L=point(f,'left','Shoulder'),R=point(f,'right','Shoulder'),H=point(f,'left','Hip'),J=point(f,'right','Hip');
 const shoulders=mixPoint(L,R,.5),hips=mixPoint(H,J,.5),height=Math.hypot(hips.x-shoulders.x,hips.y-shoulders.y);
 const neck=mixPoint(shoulders,hips,-.215),hem=mixPoint(shoulders,hips,1.13);
 const lower=s.lower||[];
 ctx.save();ctx.translate(f.x+s.x,f.y+s.y);ctx.rotate(s.rot*Math.PI/180);ctx.scale(s.scale,s.scale);ctx.translate(-f.x,-f.y);
 for(const [index,side] of ['left','right'].entries()){
  const hip=index?J:H,shoulder=index?R:L;
  const knee=point(f,side,'Knee')||{x:hip.x,y:hip.y+height*.96};
  const ankle=point(f,side,'Ankle'),end=ankle||mixPoint(hip,knee,2);
  if(lower[0]){
   const fabric=pattern(lower[0],'pants').legs[index],legWidth=Math.max(span*.64,Math.abs(J.x-H.x)*1.05);
   segment(ctx,fabric,mixPoint(hip,knee,s.trouserRise ? .12:-.18),knee,legWidth,legWidth*.79,s.trouserRise ? .20:0,.54);
   segment(ctx,fabric,knee,end,legWidth*.79,legWidth*.7,.54,1);
  }
  if(lower[1]&&ankle){const toe=point(f,side,'Toe');if(toe)segment(ctx,pattern(lower[1],'shoe').legs[index],ankle,toe,span*.20,span*.23);}
  if(s.lowerOnly) continue;
  const elbow=point(f,side,'Elbow')||{x:shoulder.x+(index?1:-1)*span*.15,y:shoulder.y+height*.56};
  const wrist=point(f,side,'Wrist')||mixPoint(shoulder,elbow,1.9);
  // Seat the sleeve cap toward the neck even when the upper arm lifts.
  const start=mixPoint(shoulder,neck,.19);
  start.y-=span*.035;
  const fabric=cloth.sleeves[index];
  if(cloth.long){segment(ctx,fabric,start,mixPoint(start,elbow,1.065),span*.46,span*.33,0,.55);segment(ctx,fabric,elbow,wrist,span*.31,span*.23,.55,1);}
  else segment(ctx,fabric,start,mixPoint(shoulder,elbow,.68),span*.46,span*.34);
 }
 if(s.lowerOnly){ctx.restore();return;}
 const width=Math.max(f.chestWidth || span*1.34, Math.min(height*.78,span*1.32));
 // Interpolate both the tilt and width between the shoulder and hip lines.
 const hipAngle=Math.atan2(J.y-H.y,J.x-H.x);
 const hemWidth=Math.max(width*.94,Math.hypot(J.x-H.x,J.y-H.y)*1.52);
 const rows=Math.max(16,Math.min(160,Math.ceil(height)));
 for(let row=0;row<rows;row++){
  const t=row/rows,center=mixPoint(neck,hem,t);
  const angle=f.angle*(1-t)+hipAngle*t;
  const chest=Math.min(1,t/.12),slope=.78+.22*Math.sin(chest*Math.PI/2);
  // Shape the side seams around the measured waist; taper smoothly to the hem.
  const waistBlend = Math.exp(-Math.pow((t - .72) / .22, 2));
  const straightWidth = width * (1-t) + hemWidth * t;
  const girth = (straightWidth + ((f.waistWidth ?? straightWidth) - straightWidth) * waistBlend) * slope;
  ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle);
  ctx.drawImage(cloth.body,0,t*cloth.body.height,cloth.body.width,cloth.body.height/rows,
    -girth/2,0,girth,Math.hypot(hem.x-neck.x,hem.y-neck.y)/rows+1);
  ctx.restore();
 }
 // A bent forearm crossing the chest must be drawn in front of the torso.
 if(cloth.long)for(const [i,side] of ['left','right'].entries()){
  const elbow=point(f,side,'Elbow'),wrist=point(f,side,'Wrist');
  if(elbow&&wrist&&wrist.x>L.x&&wrist.x<R.x&&wrist.y<hem.y&&wrist.y>neck.y)
   segment(ctx,cloth.sleeves[i],elbow,wrist,span*.31,span*.23,.55,1);
 }
 ctx.restore();
}

// Straighten the kurta front before fitting it. A catalogue pose can leave the
// two side seams at different angles and a hand-shaped gap across the print.
export function drawKurta(ctx,image,fit,sourcePose,detail){
 const w=image.width,h=image.height,source=image.getContext('2d').getImageData(0,0,w,h).data;
 const panel=document.createElement('canvas');panel.width=w;panel.height=h;
 const pc=panel.getContext('2d'),pixels=pc.createImageData(w,h);
 // Map one continuous strip of cloth. Only replace missing texels; changing
 // the horizontal scale on each scanline breaks the placket and printed motifs.
 const opaque=(x,y)=>source[(y*w+x)*4+3]>170;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   let xx=Math.min(w-1,Math.floor(w*.17+x*.66)),yy=y;
   if(!opaque(xx,yy))xx=w-1-xx;
   if(!opaque(xx,yy)){
     // Borrow a nearby intact patch, preserving its two-dimensional texture.
     for(const offset of [.17,-.17,.32,-.32,.49,-.49]){
       yy=Math.max(0,Math.min(h-1,y+Math.round(h*offset)));
       if(opaque(xx,yy))break;
     }
   }
   const i=(yy*w+xx)*4,d=(y*w+x)*4;
   pixels.data.set(source.subarray(i,i+4),d);
 }
 pc.putImageData(pixels,0,0);
 const shoulders=['left','right'].map(s=>point(fit,s,'Shoulder'));
 const hips=['left','right'].map(s=>point(fit,s,'Hip'));
 const neck=mixPoint(shoulders[0],shoulders[1],.5),hip=mixPoint(hips[0],hips[1],.5);
 const span=fit.shoulderWidth,torso=Math.hypot(hip.x-neck.x,hip.y-neck.y);
 const width=fit.chestWidth || span*1.23;
 const bounds=image.sourceBounds;
 let hemRatio=1.75;
 if(sourcePose && [11,12,23,24].every(i=>sourcePose[i]?.visibility>.5)){
   const sy=(sourcePose[11].y+sourcePose[12].y)*bounds.fullHeight/2;
   const hy=(sourcePose[23].y+sourcePose[24].y)*bounds.fullHeight/2;
   if(hy>sy)hemRatio=Math.max(1.35,Math.min(1.95,(bounds.y+h-sy)/(hy-sy)));
 }
 for(const [index,side] of ['left','right'].entries()){
   const shoulder=shoulders[index],elbow=point(fit,side,'Elbow') || {x:shoulder.x+(index?1:-1)*span*.13,y:shoulder.y+torso*.54};
   const sleeve=document.createElement('canvas');sleeve.width=40;sleeve.height=80;
   sleeve.getContext('2d').drawImage(panel,index?w*.67:w*.10,h*.13,w*.23,h*.31,0,0,40,80);
   if(detail){
     sleeve.getContext('2d').drawImage(detail,(index ? .76 : .12)*detail.width,detail.height*.21,detail.width*.11,detail.height*.24,0,0,40,80);
   }
   const cap=mixPoint(shoulder,neck,.10);
   cap.y-=span*.12;
   ctx.save();ctx.beginPath();ctx.ellipse(cap.x,cap.y+span*.08,span*.195,span*.15,fit.angle,0,Math.PI*2);ctx.clip();
   ctx.drawImage(sleeve,cap.x-span*.21,cap.y-span*.08,span*.42,span*.32);ctx.restore();
   segment(ctx,sleeve,cap,elbow,span*.40,span*.32,0,1);
 }
 const start=mixPoint(neck,hip,-.20),end=mixPoint(neck,hip,hemRatio);
 const length=Math.hypot(end.x-start.x,end.y-start.y);
 ctx.save();ctx.translate(start.x,start.y);
 ctx.rotate(-Math.atan2(end.x-start.x,end.y-start.y));
 // Clip once and draw the panel in a single pass to avoid translucent seams.
 ctx.beginPath();ctx.moveTo(-width*.20,0);
 ctx.quadraticCurveTo(-width*.28,length*.045,-width*.48,length*.07);
 ctx.lineTo(-width*.50,length*.24);ctx.lineTo(-width*.54,length);
 ctx.quadraticCurveTo(0,length*1.012,width*.54,length);
 ctx.lineTo(width*.50,length*.24);ctx.lineTo(width*.48,length*.07);
 ctx.quadraticCurveTo(width*.28,length*.045,width*.20,0);ctx.closePath();ctx.clip();
 ctx.drawImage(panel,-width*.55,0,width*1.1,length);
 if(detail){
   // Use the same photographic scale from the collar through the hem.
   // Continue occluded areas with intact cloth beside the button strip.
   const dw=detail.width,dh=detail.height,factor=width*1.36/dw;
   const patch=document.createElement('canvas');patch.width=dw;patch.height=Math.ceil(length/factor);
   const dc=patch.getContext('2d'),src=detail.getContext('2d').getImageData(0,0,dw,dh).data;
   const out=dc.createImageData(dw,patch.height);
   const repeat=(v,n)=>{const i=v%(2*n);return i<n?i:2*n-i-1;};
   const tw=Math.max(1,Math.floor(dw*.18)),th=Math.max(1,Math.floor(dh*.21));
   for(let y=0;y<patch.height;y++)for(let x=0;x<dw;x++){
     let i=(y*dw+x)*4;
     if(y>=dh || src[i+3]<190){
       if(y<dh*.12)continue;
       const u=Math.floor(dw*.29)+repeat(x,tw),v=Math.floor(dh*.25)+repeat(y,th);
       i=(v*dw+u)*4;
     }
     const dest=(y*dw+x)*4;
     out.data.set(src.subarray(i,i+4),dest);
   }
   dc.putImageData(out,0,0);
   ctx.drawImage(patch,-dw*factor/2,0,dw*factor,patch.height*factor);
 }
 ctx.restore();
}
