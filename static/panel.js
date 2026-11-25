import {matchShirtLighting} from './shirt-lighting.js';
import {replaceOldTop,fitForearms} from './replace-old-top.js';
import {drawExposedLegs,skinColour,skinTexture} from './exposed-legs.js';
import {frontVariant} from './front-variant.js';
import {repairShirt} from './repair-shirt.js';
import {transferShirt} from './photo-transfer.js';
import {PoseLandmarker, FilesetResolver} from '@mediapipe/tasks-vision';
import {extractOutfit} from './garment-parser.js';
import {fitFromPose} from './geometry.mjs';
import {drawWarpedGarment,drawKurta} from './garment-renderer.js';

const el = id => document.getElementById(id);
const video = document.querySelector('video');
const result = document.querySelector('canvas');
const status = text => { el('status').textContent = text; };
let photo, fit, mask, product, stream, poseTask, revision=0;
let windowKey;
let rendering = Promise.resolve();
let checkingPhoto = false;
const photos=new Map();
let photoMode='everyday', uploadMode='everyday',cameraRequest=0;
function showPhotoMode(mode){
  photoMode=mode;
  const saved=photos.get(mode);
  photo=saved?.photo;fit=saved?.fit;mask=saved?.mask;
  const swim=mode==='swimwear';
  el('upload').textContent=swim?(photo?'Change swimwear photo':'Add swimwear photo'):(photo?'Change photo':'Add photo');
  el('camera').textContent=photo?'Retake photo':'Open camera';
  el('photoHeading').textContent=swim?'Start with a swimwear photo':'Start with your photo';
  el('photoGuide').textContent=swim?'Wear a swimsuit and face forward with your shoulders and hips in view.':'Face forward with your shoulders and hips in the frame.';
  result.hidden=!photo;
  if(photo){
    result.width=photo.width;result.height=photo.height;
    result.getContext('2d').drawImage(photo,0,0);
  }
}

function hideDownload(){ el('save').hidden=true; }
el('save').onclick=()=>{
  if(el('save').hidden)return;
  result.toBlob(blob=>{
    if(!blob){status('Could not save this photo. Please try again.');return;}
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='ETryRoom-try-on.png';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  },'image/png');
};

function fitSelectedProduct() {
  hideDownload();
  const item = product;
  const version = ++revision;
  el('apply').hidden = true;
  if (!photo || !item || stream || checkingPhoto) return;
  rendering = rendering.then(() => {
    if (version === revision) return render(item, version);
  });
}

function stopCamera() {
  stream?.getTracks().forEach(track=>track.stop());
  el('upload').disabled=false;
  stream=null;
  video.srcObject=null;
  video.hidden=true;
  el('capture').hidden=true;
  el('camera').hidden=false;
}
window.addEventListener('pagehide',stopCamera);
el('camera').onclick=async()=>{
  const request=++cameraRequest;
  el('camera').disabled=true;
  try {
    el('upload').disabled=true;
    const opened=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:960}},audio:false});
    if(request!==cameraRequest){opened.getTracks().forEach(track=>track.stop());return;}
    stream=opened;video.srcObject=stream;
    await video.play();
    if(request!==cameraRequest)return;
    hideDownload();
    video.hidden=false;
    result.hidden=true;
    el('camera').hidden=true;
    el('capture').hidden=false;
    el('apply').hidden=true;
    status('Face the camera with your shoulders and hips in view. Step back for a full outfit.');
  } catch {if(request!==cameraRequest)return;stopCamera();status('Camera unavailable. Check camera permission and try again.');}
  finally {el('camera').disabled=false;}
};

el('capture').onclick=async()=>{
  if (!video.videoWidth) return;
  const captureStream=stream;
  el('capture').disabled=true;
  for(let seconds=3;seconds>0;seconds--){
    status('Hold your pose. Taking your photo in '+seconds+'…');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  el('capture').disabled=false;
  if(!captureStream || stream!==captureStream || !video.videoWidth) {stopCamera();status('Open the camera to try again.');return;}
  const frame=document.createElement('canvas');
  frame.width=video.videoWidth;frame.height=video.videoHeight;
  frame.getContext('2d').drawImage(video,0,0);
  await fitPhoto(frame);
};

function measureTorso(pose,mask,w,h,frame){
  const span=pose.shoulderWidth;
  for(const [key,t,min,max] of [['chestWidth',.35,1.08,1.37],['waistWidth',.78,.88,1.24]]){
    const mid=(axis,joint)=>(pose['left'+joint+axis]+pose['right'+joint+axis])/2;
    const at=axis=>mid(axis,'Shoulder')*(1-t)+mid(axis,'Hip')*t;
    const x=Math.round(at('X')*w/frame.width),y=Math.round(at('Y')*h/frame.height);
    if(x<0||x>=w||y<0||y>=h||mask[y*w+x]<.65)continue;
    let l=x,r=x;
    while(l>0&&mask[y*w+l-1]>.65)l--;
    while(r+1<w&&mask[y*w+r+1]>.65)r++;
    pose[key]=Math.min(span*max,Math.max(span*min,(r-l+1)*frame.width/w));
  }
}

async function fitPhoto(frame,mode=photoMode){
  hideDownload();
  checkingPhoto=true;
  stopCamera();
  revision++;
  el('upload').disabled=true;
  el('camera').disabled=true;
  status('Checking the framing of your photo…');
  try {
    await rendering;
    poseTask ??= await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/vision-wasm'),{
      baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task'},runningMode:'IMAGE',outputSegmentationMasks:true
    });
    let saved;
    poseTask.detect(frame, detection=>{
      const measured=fitFromPose(detection.landmarks[0],frame.width,frame.height);
      if (!measured) return;
      const segmentation=detection.segmentationMasks?.[0];
      let silhouette=null;
      if (segmentation) {
        silhouette=document.createElement('canvas');
        silhouette.width=segmentation.width;silhouette.height=segmentation.height;
        const ctx=silhouette.getContext('2d'), pixels=ctx.createImageData(silhouette.width,silhouette.height);
        const confidence=segmentation.getAsFloat32Array();
        measureTorso(measured,confidence,segmentation.width,segmentation.height,frame);
        confidence.forEach((value,i)=>{pixels.data[i*4+3]=(value-.15)*430;});
        ctx.putImageData(pixels,0,0);
      }
      saved={photo:frame,fit:measured,mask:silhouette};
    });
    if(!saved)throw Error('Choose a photo with both shoulders and hips clearly visible.');
    if(mode==='swimwear'){
      try{saved.swim=await extractOutfit(frame,'twoPiece');}catch{ /* Use pose anchors for one-piece swimsuits. */ }
    }
    photos.set(mode,saved);
    if(mode!==photoMode){checkingPhoto=false;fitSelectedProduct();return;}
    showPhotoMode(mode);
    checkingPhoto=false;
    status('Photo ready. Choose Try now beside a product.');
    fitSelectedProduct();
  } catch(error){
    if (/abort/i.test(error.message)) poseTask=null;
    status(/abort/i.test(error.message)?'Could not read the pose. Try a clear, front-facing photo.':error.message);
    result.hidden=!photo;
  } finally {checkingPhoto=false;el('upload').disabled=false;el('camera').disabled=false;}

};

el('upload').onclick=()=>{uploadMode=photoMode;el('file').click();};
el('file').onchange=async event=>{
  const file=event.target.files[0],mode=uploadMode;
  event.target.value='';
  if (!file) return;
  let bitmap;
  el('upload').disabled=el('camera').disabled=true;
  try {
    if(file.size>20*1024*1024) throw Error('Choose a photo under 20 MB.');
    bitmap=await createImageBitmap(file);
    const scale=Math.min(1,1440/Math.max(bitmap.width,bitmap.height));
    const frame=document.createElement('canvas');
    frame.width=Math.max(1,Math.round(bitmap.width*scale));
    frame.height=Math.max(1,Math.round(bitmap.height*scale));
    frame.getContext('2d').drawImage(bitmap,0,0,frame.width,frame.height);
    await fitPhoto(frame,mode);
  } catch(error){status(error.message || 'Choose a clear JPG, PNG or WebP photo.');}
  finally {bitmap?.close();el('upload').disabled=el('camera').disabled=false;}
};

const permission = item => ({origins:[new URL(item.url).origin+'/*']});
const hasAccess = item => chrome.permissions.contains(permission(item));
function listingType(name){
  if(/\b(?:bikini|swimwear|lingerie)\b/i.test(name) && /\b(?:sets?|two[ -]piece|2[ -]piece)\b/i.test(name))return 'twoPiece';
  if(/\bcrop(?:ped)?[ -]+tops?\b/i.test(name))return 'cropTop';
  if(/\btrack[ -]?suits?\b/i.test(name))return 'tracksuit';
  if(/\b(camisoles?|camis?|tank(?:\s+tops?)?|sleeveless\s+tops?)\b/i.test(name))return 'sleeveless';
  if(/\b(kurta|kurti|salwar|anarkali|kameez)\b/i.test(name)){
    if(/\b(trousers?|pants?|palazzos?|churidars?|pyjamas?|pajamas?)\b/i.test(name))return 'kurtaSet';
    if(/\b(set|dupatta|suit|pieces?)\b/i.test(name))return 'longOutfit';
    return /\b(short|top|tunic)\b/i.test(name)?'upper':'dress';
  }
  if(/\b(saree|sari|lehenga|dupatta)\b/i.test(name))return 'longOutfit';
  if(/\bdress(es)?\b/i.test(name))return 'dress';
  if(/\b(?:skirts?|skorts?)\b/i.test(name))return 'skirt';
  if(/\b(set|suit|outfit|co-ord)\b/i.test(name) && !/underwear|panty|briefs/i.test(name))return 'outfit';
  if(/\b(?:shorts|bermudas|boardshorts)\b/i.test(name))return 'shorts';
  if(/\b(panty|panties|briefs?|underwear|boxers?|hipsters?)\b/i.test(name))return 'briefs';
  if(/\b(trousers?|pants|jeans|leggings|joggers|palazzos?|slacks)\b/i.test(name))return 'trousers';
  if(/\b(shirt|top|tee|hoodie|blouse|sweater|jacket)\b/i.test(name))return 'upper';
  return 'detect';
}
// Keep one set of clothing masks per fitting photo, shared by every garment.
let measuredPhoto, wearer;
async function wearerClothing(frame,pose){
  if(measuredPhoto===frame)return wearer;
  const hipY=(pose.leftHipY+pose.rightHipY)/2;
  const parsed=await extractOutfit(frame,'wearer',(hipY-pose.shoulderWidth*.24)/frame.height);
  const {pants,skin}=parsed;
  let outline=null;
  if(pants){
    const bounds=pants.sourceBounds;
    const pixels=pants.getContext('2d').getImageData(0,0,pants.width,pants.height).data;
    const sx=frame.width/bounds.fullWidth,sy=frame.height/bounds.fullHeight;
    const rows=[];
    for(let y=0;y<pants.height;y++){
      let left=pants.width,right=-1;
      for(let x=0;x<pants.width;x++)if(pixels[(y*pants.width+x)*4+3]>140){left=Math.min(left,x);right=x;}
      if(right>left)rows[y]=[(left+bounds.x)*sx,(right+1+bounds.x)*sx];
    }
    outline={rows,top:bounds.y*sy,sy,pants,skin:skinColour(skin),texture:skinTexture(skin)};
  }
  measuredPhoto=frame;wearer={...parsed,outline};
  return wearer;
}

function drawShorts(ctx,image,outline){
  const hipX=(fit.leftHipX+fit.rightHipX)/2,hipY=(fit.leftHipY+fit.rightHipY)/2;
  const span=fit.shoulderWidth,base=Math.max(Math.hypot(fit.rightHipX-fit.leftHipX,fit.rightHipY-fit.leftHipY)*1.55,span*1.06);
  const edges=y=>{
    const row=outline?.rows[Math.round((y-outline.top)/outline.sy)];
    return row && row[0]<hipX-base*.2 && row[1]>hipX+base*.2 && row[1]-row[0]<base*1.65 ? row : null;
  };
  let waist=hipY-base*.27;
  for(let y=Math.round(hipY-base*.43);y<=hipY;y++){
    if(edges(y) && edges(y+2)){waist=y;break;}
  }
  const hip=edges(hipY) || edges(hipY+base*.15) || [hipX-base/2,hipX+base/2];
  const width=hip[1]-hip[0];
  const knees=[fit.leftKneeY,fit.rightKneeY].filter(y=>Number.isFinite(y) && y>hipY);
  const thigh=knees.length?Math.min(...knees)-hipY:span*1.35;
  const length=Math.min(hipY-waist+thigh*.67,width*1.38,Math.max(width*.5,width*image.height/image.width));
  const rgba=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
  // Fit each horizontal band to the wearer while preserving the transparent
  // space between the hems and the source waistband's curved upper edge.
  let left=hip[0],right=hip[1];
  for(let i=0;i<Math.ceil(length);i++){
    const t=i/length,srcY=Math.min(image.height-1,Math.floor(t*image.height));
    let lo=0,hi=image.width-1;
    while(lo<=hi && rgba[(srcY*image.width+lo)*4+3]<100)lo++;
    while(hi>=lo && rgba[(srcY*image.width+hi)*4+3]<100)hi--;
    if(hi<=lo)continue;
    const row=edges(waist+i);
    if(row){left+=(row[0]-left)*.35;right+=(row[1]-right)*.35;}
    // A dark pocket or hand can cut into one side of the trouser mask.
    // Keep a hip-centred minimum and allow a little ease over the thighs.
    const ease=span*.035;
    const outerLeft=Math.min(left,hipX-base*.5)-ease;
    const outerRight=Math.max(right,hipX+base*.5)+ease;
    const inset=width*.035*Math.max(0,1-t*4);
    // At curved hems and the waistband preserve the source contour.
    const contour=Math.min(1,i/5,(length-i)/6);
    const x0=lo*contour,x1=image.width-(image.width-hi-1)*contour;
    ctx.drawImage(image,x0,srcY,x1-x0,Math.min(image.height-srcY,Math.max(1,image.height/length)),outerLeft+inset,waist+i,Math.max(1,outerRight-outerLeft-2*inset),1.05);
  }
  return waist+length;
}
function drawSkirt(ctx,image,outline,name=""){
  const span=fit.shoulderWidth,hipX=(fit.leftHipX+fit.rightHipX)/2;
  const hipY=(fit.leftHipY+fit.rightHipY)/2;
  const hipWidth=Math.max(span*1.03,Math.hypot(fit.rightHipX-fit.leftHipX,fit.rightHipY-fit.leftHipY)*1.5);
  const observed=y=>{
    const edge=outline?.rows[Math.round((y-outline.top)/outline.sy)];
    return edge && edge[0]<hipX-span*.22 && edge[1]>hipX+span*.22 && edge[1]-edge[0]<hipWidth*1.65 ? edge : null;
  };
  let waist=hipY-span*.32;
  for(let y=Math.round(hipY-span*.49);y<=hipY;y++){
    if(observed(y) && observed(y+2)){waist=y;break;}
  }
  // Measure opaque fabric at the waistband and seat. A flared hem and
  // transparent catalogue margins must not determine the waist scale.
  const {width:w,height:h}=image,alpha=image.getContext('2d').getImageData(0,0,w,h).data;
  function band(t){
    const samples=[];
    for(let k=-2;k<=2;k++){
      const y=Math.max(0,Math.min(h-1,Math.round(h*(t+k*.012))));
      let l=0,r=w-1;
      while(l<r && alpha[(y*w+l)*4+3]<128)l++;
      while(r>l && alpha[(y*w+r)*4+3]<128)r--;
      if(r-l>w*.25)samples.push([l,r+1]);
    }
    samples.sort((a,b)=>(a[1]-a[0])-(b[1]-b[0]));
    return samples[samples.length>>1] || [0,w];
  }
  const belt=band(.09),seat=band(.42);
  const hip=observed(hipY) || observed(hipY+span*.1);
  const beltEdge=observed(waist+span*.10);
  const width=Math.max(hipWidth,hip?hip[1]-hip[0]:0);
  const waistWidth=Math.max(width*.83,Math.min(width,beltEdge?beltEdge[1]-beltEdge[0]:width*.91));
  const beltScale=waistWidth/(belt[1]-belt[0]);
  const seatScale=width/(seat[1]-seat[0]);
  const center=hip ? (hip[0]+hip[1])/2 : hipX;
  const angle=Math.atan2(fit.rightHipY-fit.leftHipY,fit.rightHipX-fit.leftHipX);
  // The horizontal fit follows the waist and seat independently. Use the
  // wearer's leg length for mini styles, including frames cropped above the knee.
  const knees=[fit.leftKneeY,fit.rightKneeY].filter(y=>Number.isFinite(y) && y>hipY+span*.55);
  const thigh=knees.length?Math.min(...knees)-hipY:span*1.35;
  const naturalLength=h*hipWidth/(seat[1]-seat[0]);
  const length=/\bmini\b/i.test(name)?Math.min(naturalLength,hipY-waist+thigh*.49):naturalLength;
  const yScale=length/h;
  ctx.save();ctx.translate(center,waist);ctx.rotate(angle);
  let extraLeft=0,extraRight=0;
  for(let i=0;i<Math.ceil(length);i++){
    const y=Math.min(h-1,Math.floor(i/yScale));
    let l=0,r=w-1;
    while(l<r && alpha[(y*w+l)*4+3]<128)l++;
    while(r>l && alpha[(y*w+r)*4+3]<128)r--;
    if(l===r)continue;
    const t=Math.min(1,i/Math.max(1,hipY-waist));
    const blend=t*t*(3-2*t);
    const scale=beltScale+(seatScale-beltScale)*blend;
    const origin=((belt[0]+belt[1])*(1-blend)+(seat[0]+seat[1])*blend)/2;
    const x0=(l-origin)*scale,x1=(r+1-origin)*scale;
    // Fit through the hip line. Below the seat the source silhouette supplies the flare.
    const edge=observed(waist+i);
    const seatWeight=Math.min(1,i/Math.max(1,length*.12),Math.max(0,1-(waist+i-hipY)/(span*.32)));
    const dl=edge?Math.max(0,center+x0-edge[0])*seatWeight:0;
    const dr=edge?Math.max(0,edge[1]-center-x1)*seatWeight:0;
    extraLeft+=(dl-extraLeft)*.5;extraRight+=(dr-extraRight)*.5;
    const horizontal=scale+(extraLeft+extraRight)/(r-l+1);
    ctx.drawImage(image,0,i/yScale,w,Math.min(h-i/yScale,1/yScale),x0-extraLeft-l*horizontal,i,w*horizontal,1.05);
  }
  ctx.restore();
  return waist+length;
}
function drawTwoPiece(ctx,parts,body,swim){
  for(const [image,joint,across,rise] of [[parts.upper,'Shoulder',1.08,.05],[parts.pants,'Hip',1.10,-.19]]){
    const existing=joint==='Shoulder'?swim?.upper:swim?.pants;
    if(existing){
      const b=existing.sourceBounds,sx=ctx.canvas.width/b.fullWidth,sy=ctx.canvas.height/b.fullHeight;
      const garmentWidth=existing.width*sx;
      const garmentHeight=garmentWidth*image.height/image.width;
      const bottom=(b.y+existing.height)*sy;
      ctx.drawImage(image,b.x*sx,joint==='Shoulder'?bottom-garmentHeight:b.y*sy,garmentWidth,garmentHeight);
      continue;
    }
    const lx=body['left'+joint+'X'],ly=body['left'+joint+'Y'];
    const rx=body['right'+joint+'X'],ry=body['right'+joint+'Y'];
    const width=joint==='Shoulder'?body.shoulderWidth*across:Math.max(Math.hypot(rx-lx,ry-ly)*1.48,body.shoulderWidth*across);
    const height=width*image.height/image.width;
    const torso=Math.hypot((body.leftHipX+body.rightHipX-body.leftShoulderX-body.rightShoulderX)/2,
      (body.leftHipY+body.rightHipY-body.leftShoulderY-body.rightShoulderY)/2);
    ctx.save();ctx.translate((lx+rx)/2,(ly+ry)/2);ctx.rotate(Math.atan2(ry-ly,rx-lx));
    // Align the lower edge of the bust panel even if thin ties were lost in segmentation.
    const top=joint==='Shoulder'?torso*.39-height:torso*rise;
    ctx.drawImage(image,-width/2,top,width,height);ctx.restore();
  }
}
function drawBottom(ctx,image,type){
  const dx=fit.rightHipX-fit.leftHipX,dy=fit.rightHipY-fit.leftHipY;
  const width=Math.max(Math.hypot(dx,dy)*1.48,fit.shoulderWidth*.87);
  const x=(fit.leftHipX+fit.rightHipX)/2,y=(fit.leftHipY+fit.rightHipY)/2;
  if(type==='trousers'){
    drawWarpedGarment(image,fit,ctx,{x:0,y:0,rot:0,scale:1,lower:[image],lowerOnly:true,trouserRise:true});
    // Draw the rise as one panel across both hips so the waistband stays joined.
    ctx.save();
    ctx.translate(x,y);ctx.rotate(Math.atan2(dy,dx));
    ctx.drawImage(image,0,0,image.width,image.height*.21,-width*.55,-width*.26,width*1.1,width*.52);
    ctx.restore();
    return;
  }
  // Keep both leg openings and the waistband together at the observed hips.
  const height=Math.min(width*.94,Math.max(width*.32,width*image.height/image.width));
  ctx.save();
  ctx.translate(x,y);ctx.rotate(Math.atan2(dy,dx));
  ctx.drawImage(image,-width/2,-width*.24,width,height);
  ctx.restore();
}
function drawLongOutfit(ctx,garment,landmarks,body){
  const crop=garment.sourceBounds;
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const at=i=>({x:landmarks[i].x*crop.fullWidth-crop.x,y:landmarks[i].y*crop.fullHeight-crop.y});
  const shoulders={x:(body.leftShoulderX+body.rightShoulderX)/2,y:(body.leftShoulderY+body.rightShoulderY)/2};
  const hips={x:(body.leftHipX+body.rightHipX)/2,y:(body.leftHipY+body.rightHipY)/2};
  const targetLength=Math.hypot(hips.x-shoulders.x,hips.y-shoulders.y);
  // Anchor at the shoulders. A draped panel can extend much farther to one side.
  let origin={x:garment.width*.5,y:garment.height*.07};
  let sourceAngle=0;
  let widthScale=body.shoulderWidth*1.55/garment.width;
  let lengthScale=targetLength*2.1/garment.height;
  if(landmarks && [11,12,23,24].every(i=>landmarks[i]?.visibility>.4)){
    const left=at(11),right=at(12),top=midpoint(left,right),bottom=midpoint(at(23),at(24));
    const span=Math.hypot(left.x-right.x,left.y-right.y);
    const length=Math.hypot(bottom.x-top.x,bottom.y-top.y);
    if(span>garment.width*.16 && length>garment.height*.15){
      origin=top;
      widthScale=body.shoulderWidth/span;
      lengthScale=targetLength/length;
      sourceAngle=Math.atan2(bottom.x-top.x,bottom.y-top.y);
    }
  }
  ctx.save();
  ctx.translate(shoulders.x,shoulders.y);
  ctx.rotate(-Math.atan2(hips.x-shoulders.x,hips.y-shoulders.y));
  ctx.scale(widthScale,lengthScale);
  ctx.rotate(sourceAngle);
  ctx.drawImage(garment,-origin.x,-origin.y);
  ctx.restore();
}

let replacement;
el('productUpload').onclick=()=>el('productFile').click();
el('productFile').onchange=event=>{
  const file=event.target.files[0];
  event.target.value='';
  if(file && product){replacement={item:product,file};fitSelectedProduct();}
};

function garmentPoseScore(bitmap){
  if(!poseTask)return 0;
  let score=0;
  const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
  const frame=document.createElement('canvas');
  frame.width=Math.max(1,Math.round(bitmap.width*scale));
  frame.height=Math.max(1,Math.round(bitmap.height*scale));
  frame.getContext('2d').drawImage(bitmap,0,0,frame.width,frame.height);
  try{
    poseTask.detect(frame,result=>{
      const world=result.worldLandmarks?.[0],points=result.landmarks?.[0];
      if(!world || !points || Math.min(points[11].visibility,points[12].visibility)<.55)return;
      // In an unmirrored front view the person's left shoulder is on image right.
      // Shoulder depth separates a turned torso from a face looking at the lens.
      const dx=world[11].x-world[12].x,dz=world[11].z-world[12].z;
      const yaw=Math.atan2(Math.abs(dz),dx);
      score=2.5*(1-yaw/(Math.PI/2));
      if(points[0].y<.025 || points[0].y>1)score-=.45;
    });
  }catch{ /* A flat lay can still be ranked by its garment mask. */ }
  return score;
}

async function chooseProductView(item,target,version){
  const uploaded=replacement?.item===item;
  const urls=uploaded?[null]:[...new Set([item.url,...(item.gallery || []),item.displayUrl].filter(Boolean))];
  let best=null,bestScore=-Infinity,lastError,detail,detailScore=0;
  const seen=new Set();
  async function evaluate(bitmap){
    try{
      if(version!==revision)return;
      const parts=await extractOutfit(bitmap,target==='kurtaSet'?'kurtaGallery':target);
      if(parts.detail){
        const front=parts.detail;
        // Keep a portrait with the collar in frame, not an isolated fabric swatch.
        const b=front.sourceBounds;
        const quality=front.width*(1+Math.max(0,front.facing));
        if(front.facing>0 && b.y>b.fullHeight*.06 && quality>detailScore){
          detail=front;detailScore=quality;
        }
        lastError=Error('A full-length view showing both pieces is needed.');
        return;
      }
      const piece=parts.garment || parts.upper || parts.pants;
      const bounds=piece.sourceBounds;
      const clipped=[bounds.x,bounds.y,bounds.fullWidth-bounds.x-piece.width,bounds.fullHeight-bounds.y-piece.height].filter(v=>v<=2).length;
      const poseScore=urls.length>1?garmentPoseScore(bitmap):0;
      const score=.4*Math.min(1,Math.min(piece.width,piece.height)/260)-clipped*.6+1.4*(piece.facing || 0)+poseScore;
      if(score>bestScore){best?.bitmap.close();best={bitmap,parts};bestScore=score;bitmap=null;}
    }catch(error){lastError=error;}
    finally{bitmap?.close();}
  }
  try{
    for(const url of urls){
      if(version!==revision)break;
      let bitmap;
      try{
        if(uploaded)bitmap=await createImageBitmap(replacement.file);
        else{
          const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
          if(!response.ok || seen.has(response.url))continue;
          bitmap=await createImageBitmap(await response.blob());seen.add(response.url);
        }
      }catch{continue;}
      await evaluate(bitmap);
      if(uploaded)break;
    }
    if(!best && !uploaded && version===revision && !seen.has(item.displayUrl)){
      const preview=await chrome.runtime.sendMessage({type:'visible-product',selectionId:item.selectionId});
      if(preview?.data)await evaluate(await createImageBitmap(await (await fetch(preview.data)).blob()));
    }
    if(version!==revision){best?.bitmap.close();return null;}
    if(!best && lastError)throw lastError;
    if(best && detail && detail.width>best.parts.garment.width*1.15)best.parts.detail=detail;
    return best;
  }catch(error){best?.bitmap.close();throw error;}
}

async function render(item, version) {
  const multiple=(item.gallery?.length || 0)>1 && replacement?.item!==item;
  status(multiple?'Finding a clear view of this garment…':'Fitting the garment to your photo…');
  let bitmap;
  try {
    const requested=listingType(item.name);
    const sleeveless=requested==='sleeveless';
    const target=sleeveless || requested==='cropTop'?'upper':requested==='outfit'?'panelOutfit':requested;
    let view;
    try{view=await chooseProductView(item,target,version);}
    catch(error){
      if(version!==revision)return;
      el('productUpload').hidden=false;
      if(multiple)throw Error('The available product photos did not show the garment clearly enough. You can use a saved product image.');
      throw error;
    }
    bitmap=view?.bitmap;
    if(version!==revision)return;
    if(!view){
      el('productUpload').hidden=false;
      el('apply').hidden=!/^https?:/.test(item.url) || await hasAccess(item);
      status('Keep the product image visible and select it again, or use a saved copy.');
      return;
    }
    const parts=view.parts;
    el('productUpload').hidden=true;
    const type=parts.detectedType ?? requested;
    if(version!==revision)return;

    const layer=document.createElement('canvas');
    layer.width=photo.width;layer.height=photo.height;
    const fabric=layer.getContext('2d');
    const pack=/\b(?:multi[- ]?pack|pack\s*(?:of\s*)?[2-9]|[2-9][ -]?pack|combo\s+of\s+[2-9])\b/i.test(item.name);
    if(pack && parts.upper){
      const single=frontVariant(parts.upper);
      if(!single)throw Error('Choose an individual product photo. The pieces overlap in this pack.');
      parts.upper=single;
    }
    const old=type==='twoPiece'?null:await wearerClothing(photo,fit);
    if(version!==revision)return;
    let hem;
    if(type==='twoPiece'){
      drawTwoPiece(fabric,parts,fit,photos.get('swimwear')?.swim);
    }else if(sleeveless || requested==='cropTop'){
      // Fit the isolated silhouette as a whole, including its neckline and straps.
      const x=(fit.leftShoulderX+fit.rightShoulderX)/2,y=(fit.leftShoulderY+fit.rightShoulderY)/2;
      const hipX=(fit.leftHipX+fit.rightHipX)/2,hipY=(fit.leftHipY+fit.rightHipY)/2;
      const torso=Math.hypot(hipX-x,hipY-y),width=fit.chestWidth || fit.shoulderWidth*1.2;
      fabric.save();fabric.translate(x,y);fabric.rotate(-Math.atan2(hipX-x,hipY-y));
      const cropped=requested==='cropTop';
      if(cropped)repairShirt(parts.upper,true);
      fabric.drawImage(parts.upper,-width/2,-torso*.13,width,torso*(cropped?1.02:1.25));fabric.restore();
    }else if(type==='tracksuit'){
      drawBottom(fabric,parts.pants,'trousers');
      repairShirt(parts.upper);
      drawWarpedGarment(parts.upper,fit,fabric,{x:0,y:0,rot:0,scale:1,lower:[]});
    }else if(type==='shorts'){
      hem=drawShorts(fabric,parts.pants,old.outline);
    }else if(type==='skirt'){
      hem=drawSkirt(fabric,parts.pants,old.outline,item.name);
    }else if(type==='briefs'||type==='trousers'){
      drawBottom(fabric,parts.pants,type);
    }else{

    let sourcePose;
    // Run optional source-pose estimation on a bounded canvas. Some gallery
    // thumbnails have no person, or cause the vision runtime to reject the frame.
    const source=document.createElement('canvas');
    const ratio=Math.min(1,960/Math.max(bitmap.width,bitmap.height));
    source.width=Math.max(1,Math.round(bitmap.width*ratio));
    source.height=Math.max(1,Math.round(bitmap.height*ratio));
    source.getContext('2d').drawImage(bitmap,0,0,source.width,source.height);
    if(poseTask && !pack)try {
      poseTask.detect(source,detection=>{sourcePose=detection.landmarks[0];});
    } catch {poseTask=null;}
    if(type==='longOutfit' || type==='kurtaSet'){
      if(type==='kurtaSet'){
        drawBottom(fabric,parts.pants,'trousers');
        repairShirt(parts.garment);
        drawKurta(fabric,parts.garment,fit,sourcePose,parts.detail);
        fitForearms(fabric,parts,sourcePose,fit,old,photo);
      }else drawLongOutfit(fabric,parts.garment,sourcePose,fit);
    }else{
    repairShirt(parts.upper);
    const upperLayer=document.createElement('canvas');
    upperLayer.width=layer.width;upperLayer.height=layer.height;
    const transferred=transferShirt(upperLayer.getContext('2d'),parts.upper,sourcePose,parts.upper.sourceBounds,fit, /\bshirts?\b/i.test(item.name) && !/\b(crop(?:ped)?|tucked|kurti|dress)\b/i.test(item.name),parts.arms);
    drawWarpedGarment(parts.upper,fit,fabric,{x:0,y:0,rot:0,scale:1,lower:type==='upper'?[]:[parts.pants,parts.shoes],lowerOnly:transferred});
    if(transferred)fabric.drawImage(upperLayer,0,0);
    if(type==='upper'){
      matchShirtLighting(fabric,old.upper,photo,fit.shoulderWidth);
      if(sourcePose && parts.arms)fitForearms(fabric,parts,sourcePose,fit,old,photo);
    }
    }
    }
    if(mask && type!=='longOutfit' && type!=='skirt'){
      fabric.save();fabric.globalCompositeOperation='destination-in';
      fabric.drawImage(mask,0,0,layer.width,layer.height);fabric.restore();
    }
    // The fitted pieces determine the regions to replace, including detected
    // items and sets. Reconstruction is composited behind the finished fabric.
    if(old && (parts.upper || parts.garment))replaceOldTop(fabric,photo,fit,old);
    if(old && type!=='kurtaSet' && (parts.pants || parts.garment))drawExposedLegs(fabric,photo,fit,old.outline,hem);
    const ctx=result.getContext('2d');ctx.drawImage(photo,0,0);ctx.drawImage(layer,0,0);
    result.hidden=false;el('save').hidden=false;status(type==='twoPiece'?'Two-piece preview over your photo.':'Your try-on is ready.');
  } catch(error){if(version===revision)status(/abort/i.test(error.message)?'The garment could not be extracted. Choose a clearer product image.':error.message);}
  finally {bitmap?.close();}
}
el('apply').onclick=async()=>{
  const item=product;
  if (!item) return pickProduct();
  try {
    if (await chrome.permissions.request(permission(item))) {
      if (item === product) fitSelectedProduct();
    } else status('Allow access to the product image to try it on.');
  } catch { status('Could not access this image. Pick another product photo.'); }
};
function select(item) {
  hideDownload();
  revision++;
  if (!/^(https?:|blob:|data:image\/)/i.test(item?.url||'')){status('Choose a product with a web image.');return;}
  el('productUpload').hidden=true;
  replacement=null;
  const mode=listingType(item.name)==='twoPiece'?'swimwear':'everyday';
  if(mode!==photoMode){cameraRequest++;stopCamera();showPhotoMode(mode);}
  product=item;el('product').textContent=item.name || 'Selected product';
  el('apply').hidden=true;
  if(photo && !stream){
    result.getContext('2d').drawImage(photo,0,0);
    fitSelectedProduct();
  } else if(!stream) status(photoMode==='swimwear'?'Add or take a front-facing photo in swimwear to try this set.':'Add a photo or open the camera to try this on.');
}
el('pick').onclick=pickProduct;
async function pickProduct(){
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
      window.__etryPick?.abort();
      const controller=new AbortController();window.__etryPick=controller;
      window.addEventListener('click',event=>{
        const img=event.composedPath().find(node=>node instanceof HTMLImageElement || node.matches?.('.image-grid-image'))
          ?? document.elementsFromPoint(event.clientX,event.clientY).find(node=>node instanceof HTMLImageElement || node.matches?.('.image-grid-image'));
        if(!img)return;
        event.preventDefault();event.stopImmediatePropagation();controller.abort();
        chrome.runtime.sendMessage({type:'picked',...(window.__etryProductForImage?.(img) || {url:img.currentSrc,name:img.alt || document.title})});
      },{capture:true,signal:controller.signal});
      window.addEventListener('keydown',e=>{if(e.key==='Escape')controller.abort();},{signal:controller.signal});
    }});
    status('Click the clothing photo on the page. Escape cancels.');
  } catch {status('Use Try on beside the product’s Add to cart button.');}
};
async function init(){
  windowKey='product-'+(await chrome.windows.getCurrent()).id;
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && changes[windowKey]?.newValue)select(changes[windowKey].newValue);});
  const stored=await chrome.storage.session.get(windowKey);
  if(stored[windowKey])select(stored[windowKey]);
}
init();
