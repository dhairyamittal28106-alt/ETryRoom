// SegFormer clothing labels from Xenova/segformer_b2_clothes (quantized ONNX).
import {env,InferenceSession,Tensor} from 'onnxruntime-web/wasm';
env.wasm.numThreads=1;
env.wasm.wasmPaths={mjs:new URL('/static/parser/ort-wasm-simd-threaded.js',location.origin).href,wasm:new URL('/static/parser/ort-wasm-simd-threaded.wasm',location.origin).href};
let parser;
export async function extractOutfit(image){
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
  function cropLabels(accepted,minimum){
   const mask=document.createElement('canvas');mask.width=w;mask.height=h;
   const mc=mask.getContext('2d'),alpha=mc.createImageData(w,h);
   let left=w,top=h,right=-1,bottom=-1,count=0;
   for(let i=0;i<size;i++){
    if(!accepted.includes(labels[i]))continue;
   alpha.data[i*4+3]=255;count++;
   const x=i%w,y=Math.floor(i/w);
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(count<minimum)return null;
  mc.putImageData(alpha,0,0);
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const full=document.createElement('canvas');full.width=Math.max(1,Math.round(image.width*scale));full.height=Math.max(1,Math.round(image.height*scale));
  const fc=full.getContext('2d');fc.drawImage(image,0,0,full.width,full.height);
  fc.globalCompositeOperation='destination-in';fc.drawImage(mask,0,0,full.width,full.height);
  const sx=full.width/w,sy=full.height/h;
  const crop=document.createElement('canvas');crop.width=Math.ceil((right-left+1)*sx);crop.height=Math.ceil((bottom-top+1)*sy);
  crop.getContext('2d').drawImage(full,-left*sx,-top*sy);return crop;
  }
  const upper=cropLabels([4,7],size*.015);
  if(!upper)throw Error('Choose a photo that includes a visible top or jacket.');
  return {upper,pants:cropLabels([6],20),shoes:cropLabels([9,10],4),outfit:cropLabels([4,5,6,7,8,9,10,17],1)};
 }finally{tensor.dispose();if(result)Object.values(result).forEach(output=>output.dispose());}
}
