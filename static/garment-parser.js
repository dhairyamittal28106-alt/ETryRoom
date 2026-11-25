// SegFormer clothing labels from Xenova/segformer_b2_clothes (quantized ONNX).
import {env,InferenceSession,Tensor} from 'onnxruntime-web/wasm';
env.wasm.numThreads=1;
env.wasm.wasmPaths={mjs:new URL('/static/parser/ort-wasm-simd-threaded.js',location.origin).href,wasm:new URL('/static/parser/ort-wasm-simd-threaded.wasm',location.origin).href};
let parser;
export async function extractOutfit(image, target="outfit", waistFraction=.55){
 if(!parser)parser=InferenceSession.create('/static/parser/garment-parser.onnx',{executionProviders:['wasm']}).catch(error=>{parser=null;throw error;});
 const session=await parser;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,512,512);
 const pixels=ctx.getImageData(0,0,512,512).data,n=512*512,input=new Float32Array(n*3);
 const means=[.485,.456,.406],std=[.229,.224,.225];
 for(let channel=0;channel<3;channel++)for(let i=0;i<n;i++)input[channel*n+i]=(pixels[i*4+channel]/255-means[channel])/std[channel];
 const tensor=new Tensor('float32',input,[1,3,512,512]);
 let result;
 try{
  result=await session.run({[session.inputNames[0]]:tensor});
  const logits=result[session.outputNames[0]], [,classes,h,w]=logits.dims,size=w*h;
  const labels=new Uint8Array(size);
  for(let i=0;i<size;i++){
   let best=0;
   for(let k=1;k<classes;k++)if(logits.data[k*size+i]>logits.data[best*size+i])best=k;
   labels[i]=best;
  }
  // Estimate orientation from the model's upper face, excluding exposed neck
  // below the hairline. Unmodelled garments and headless crops stay neutral.
  function facing(left,right,garmentTop){
    const margin=(right-left+1)*.22;
    let first=h,last=-1,count=0;
    const head=[2,3,11]; // hair, sunglasses and face
    const x0=Math.max(0,Math.floor(left-margin)),x1=Math.min(w-1,Math.ceil(right+margin));
    for(let y=0;y<=Math.min(h-1,garmentTop+h*.05);y++){
      for(let x=x0;x<=x1;x++)if(head.includes(labels[y*w+x])){
        first=Math.min(first,y);last=y;count++;
      }
    }
    if(count<20 || last-first<4)return 0;
    let visible=0,total=0;
    for(let y=Math.floor(first+(last-first)*.29);y<=first+(last-first)*.72;y++){
      for(let x=x0;x<=x1;x++){
        const label=labels[y*w+x];
        if(!head.includes(label))continue;
        total++;
        if(label===3 || label===11)visible++;
      }
    }
    if(total<12)return 0;
    return Math.max(-1,Math.min(1,(visible/total-.22)*3));
  }
  function cropLabels(accepted,minimum){
   let left=w,top=h,right=-1,bottom=-1,count=0;
   for(let i=0;i<size;i++){
    if(!accepted.includes(labels[i]))continue;
   count++;
   const x=i%w,y=Math.floor(i/w);
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(count<minimum)return null;
  // Refine boundary labels against the source colours. The low-resolution
  // mask alone can include a bright handbag edge inside a patterned sleeve.
  const fine=document.createElement('canvas');fine.width=512;fine.height=512;
  const fineCtx=fine.getContext('2d'),fineAlpha=fineCtx.createImageData(512,512);
  const allowed=Uint8Array.from(labels,label=>accepted.includes(label)?255:0);
  for(let py=0;py<512;py++)for(let px=0;px<512;px++){
    const pos=(py*512+px)*4;
    const gx=(px+.5)*w/512-.5,gy=(py+.5)*h/512-.5;
    const ix=Math.floor(gx),iy=Math.floor(gy);
    let sum=0,weight=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const col=Math.max(0,Math.min(w-1,ix+dx)),row=Math.max(0,Math.min(h-1,iy+dy));
      const sample=(Math.floor((row+.5)*512/h)*512+Math.floor((col+.5)*512/w))*4;
      const delta=Math.abs(pixels[pos]-pixels[sample])+Math.abs(pixels[pos+1]-pixels[sample+1])+Math.abs(pixels[pos+2]-pixels[sample+2]);
      const influence=(1-Math.abs(gx-ix-dx))*(1-Math.abs(gy-iy-dy))/(1+(delta/45)**2);
      weight+=influence;sum+=allowed[row*w+col]*influence;
    }
    fineAlpha.data[pos+3]=sum/weight;
  }
  fineCtx.putImageData(fineAlpha,0,0);
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const full=document.createElement('canvas');full.width=Math.max(1,Math.round(image.width*scale));full.height=Math.max(1,Math.round(image.height*scale));
  const fc=full.getContext('2d');fc.drawImage(image,0,0,full.width,full.height);
  fc.globalCompositeOperation='destination-in';fc.drawImage(fine,0,0,full.width,full.height);
  const sx=full.width/w,sy=full.height/h;
  const crop=document.createElement('canvas');crop.width=Math.ceil((right-left+1)*sx);crop.height=Math.ceil((bottom-top+1)*sy);
  crop.getContext('2d').drawImage(full,-left*sx,-top*sy);
   crop.sourceBounds={x:left*sx,y:top*sy,fullWidth:full.width,fullHeight:full.height};
   if(target!=='wearer')crop.facing=facing(left,right,top);
   return crop;
  }
  if(['longOutfit','dress','detect','panelOutfit'].includes(target)){
   let dressPixels=0,first=h,last=-1;
   for(let i=0;i<size;i++)if(labels[i]===7){
    dressPixels++;const row=Math.floor(i/w);first=Math.min(first,row);last=Math.max(last,row);
   }
   const longShape=dressPixels>size*.055 && last-first>h*.52;
   if(target==='longOutfit' || target==='dress' || (longShape && target==='detect') || (longShape && target==='panelOutfit')){
    const garment=cropLabels(target==='dress' || target==='detect'?[4,7]:[4,5,6,7,8,17],size*.02);
    if(!garment)throw Error('Choose a front view showing the full garment.');
    return {garment,detectedType:'longOutfit'};
   }
  }
  if(target==='kurtaSet' || target==='kurtaGallery'){
    const garment=cropLabels([4,7,17],size*.015),pants=cropLabels([6],size*.012);
    if(!garment || !pants || pants.sourceBounds.y+pants.height < garment.sourceBounds.y+garment.height+image.height*.025*Math.min(1,1200/Math.max(image.width,image.height)))
      {
        if(target==='kurtaGallery' && garment)return {detail:garment};
        throw Error('A full-length product view is needed to fit the kurta and trousers together.');
      }
    return {garment,pants,arms:[cropLabels([14],8),cropLabels([15],8)],detectedType:'kurtaSet'};
  }
  if(target==='twoPiece'){
    // Preserve both cups as a single cutout, including their original spacing.
    // The parser sometimes assigns the waistband the same label as the cups.
    // Split at the uncovered midriff before calculating either piece's bounds.
    const counts=new Uint16Array(h);
    for(let i=0;i<size;i++)if([4,5,6].includes(labels[i]))counts[Math.floor(i/w)]++;
    const occupied=[...counts.keys()].filter(y=>counts[y]>=Math.max(2,w*.035));
    let split=-1,gap=h*.055;
    for(let i=1;i<occupied.length;i++){
      const prev=occupied[i-1],next=occupied[i];
      if(next-prev>gap && prev-occupied[0]>=h*.045 && occupied.at(-1)-next>=h*.045){
        gap=next-prev;split=(prev+next)/2;
      }
    }
    if(split>0)for(let i=0;i<size;i++){
      if([4,5,6].includes(labels[i]))labels[i]=Math.floor(i/w)<split?4:6;
    }
    const upper=cropLabels([4],8),pants=cropLabels([6,5],8);
    if(!upper || !pants || pants.sourceBounds.y<upper.sourceBounds.y+upper.height*.65 ||
       pants.height>pants.width*1.05)throw Error('Choose a front view showing both swimwear pieces.');
    return {upper,pants,detectedType:'twoPiece'};
  }
  if(target==='tracksuit'){
    const upper=cropLabels([4],size*.015),pants=cropLabels([6],size*.015);
    if(!upper || !pants || pants.sourceBounds.y+ pants.height*.45 <= upper.sourceBounds.y+upper.height*.6)
      throw Error('Choose a full-length product photo showing both the track jacket and trousers.');
    return {upper,pants,detectedType:'tracksuit'};
  }
  if(target==='wearer'){
    // A one-piece garment crosses both replacement regions. Divide only that
    // class at the wearer's measured waist; keep shirts and trousers intact.
    for(let i=0;i<size;i++){
      if(labels[i]===7)labels[i]=Math.floor(i/w)+.5<waistFraction*h?4:5;
    }
    return {upper:cropLabels([4,17],4),pants:cropLabels([5,6],4),
      skin:cropLabels([11],4) || cropLabels([14,15],4) || cropLabels([12,13],4)};
  }
  if(target==='detect'){
   let upperPixels=0,pantsPixels=0;
   for(const label of labels){
    if(label===4 || label===7)upperPixels++;
    if(label===6)pantsPixels++;
   }
   if(pantsPixels>=20 && (upperPixels<size*.015 || pantsPixels>upperPixels*4)){
    const pants=cropLabels([6],20);
    return {pants,detectedType:pants.height>pants.width*1.15?'trousers':'briefs'};
   }
  }
  if(target==='briefs' || target==='shorts' || target==='trousers'){
   const pants=cropLabels([6],20);
   if(!pants)throw Error('Could not isolate the selected bottom. Try a clear front view of the item.');
   return {pants};
  }
  if(target==='skirt' || target==='detect'){
   const skirt=cropLabels([5],size*.025);
   if(skirt && (target==='skirt' || labels.filter(v=>v===5).length>labels.filter(v=>v===4 || v===7).length*2))
     return {pants:skirt,detectedType:'skirt'};
   if(target==='skirt')throw Error('Choose a front view with the skirt clearly visible.');
  }
  const upper=cropLabels([4,7],size*.015);
  if(upper && (target==='upper'||target==='detect'))return {upper,arms:[cropLabels([14],8),cropLabels([15],8)],detectedType:'upper'};
  if(!upper)throw Error('Choose a photo that includes a visible top or jacket.');
  return {upper,pants:cropLabels([6],20),shoes:cropLabels([9,10],4),outfit:cropLabels([4,5,6,7,8,9,10,17],1)};
 }finally{tensor.dispose();if(result)Object.values(result).forEach(output=>output.dispose());}
}
