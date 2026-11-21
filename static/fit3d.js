import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const canvas=document.getElementById('threeCanvas');
let renderer,shirt,shirtMaterial,shirtGraphicMaterial,sleeveMaterial,shortSleeves=[],longSleeves=[],controls;

function lathe(points,material,scene){
 const curve=new THREE.SplineCurve(points.map(([radius,y])=>new THREE.Vector2(radius,y)));
 const mesh=new THREE.Mesh(new THREE.LatheGeometry(curve.getPoints(64),48),material);
 mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
function bodyGeometry(){
 const rings=[[.82,.24,.15],[.94,.29,.17],[1.10,.32,.165],[1.30,.29,.15],[1.50,.30,.155],[1.72,.34,.175],[1.94,.38,.185],[2.10,.35,.17],[2.20,.25,.135],[2.28,.125,.105],[2.48,.115,.10],[2.55,.12,.105]];
 const rows=72,cols=56,positions=[],indices=[];
 function profile(y){
  for(let i=0;i<rings.length-1;i++){const a=rings[i],b=rings[i+1];if(y>=a[0]&&y<=b[0]){let t=(y-a[0])/(b[0]-a[0]);t=t*t*(3-2*t);return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}}
  return rings[y<rings[0][0]?0:rings.length-1].slice(1);
 }
 for(let j=0;j<=rows;j++){
  const y=.82+j/rows*1.73,[width,depth]=profile(y);
  for(let i=0;i<=cols;i++){const angle=i/cols*Math.PI*2;positions.push(Math.sin(angle)*width,y,Math.cos(angle)*depth);}
 }
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;indices.push(a,b,c,b,d,c);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function capsule(radius,length,material,position,angle=0){
 const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,length,8,24),material);
 mesh.position.set(...position);mesh.rotation.z=angle;mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
// A full shirt shell, from the shoulder seams down to the hip.
const SHIRT_RINGS=[[2.42,.13,.108],[2.34,.19,.135],[2.25,.34,.17],[2.18,.455,.205],[2.02,.445,.22],[1.82,.415,.21],[1.60,.375,.195],[1.37,.35,.185],[1.14,.35,.185],[.96,.33,.175],[.88,.315,.17]];
const SHIRT_TOP=2.42,SHIRT_BOTTOM=.88;
function shirtProfileAt(y){
 for(let i=0;i<SHIRT_RINGS.length-1;i++){
  const a=SHIRT_RINGS[i],b=SHIRT_RINGS[i+1];
  if(y>a[0]||y<b[0])continue;
  const prev=SHIRT_RINGS[Math.max(0,i-1)],next=SHIRT_RINGS[Math.min(i+2,SHIRT_RINGS.length-1)];
  const dy=b[0]-a[0],t=(y-a[0])/dy;
  return [1,2].map(k=>{
   const m0=dy*(b[k]-prev[k])/(b[0]-prev[0]),m1=dy*(next[k]-a[k])/(next[0]-a[0]);
   return (1-t)**2*((1+2*t)*a[k]+t*m0)+t*t*((3-2*t)*b[k]+(t-1)*m1);
  });
 }
 return SHIRT_RINGS[SHIRT_RINGS.length-1].slice(1);
}
function shirtGeometry(){
 const rows=52,cols=64,positions=[],uv=[],indices=[];
 for(let j=0;j<=rows;j++){
  const t=j/rows,y=SHIRT_TOP-t*(SHIRT_TOP-SHIRT_BOTTOM),[width,depth]=shirtProfileAt(y);
  for(let i=0;i<=cols;i++){
   const u=i/cols,angle=(u-.5)*Math.PI*2;
   positions.push(Math.sin(angle)*(width+.012),y,Math.cos(angle)*(depth+.012));uv.push(u,1-t);
  }
 }
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;indices.push(a,c,b,b,c,d);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function shirtGraphicGeometry(){
 const rows=68,cols=52,positions=[],uv=[],indices=[],arc=Math.asin(.965);
 for(let j=0;j<=rows;j++){
  const t=j/rows,y=SHIRT_TOP-t*(SHIRT_TOP-SHIRT_BOTTOM),[width,depth]=shirtProfileAt(y);
  for(let i=0;i<=cols;i++){
   const u=i/cols,angle=(u-.5)*2*arc;positions.push(Math.sin(angle)*(width+.021),y,Math.cos(angle)*(depth+.021));uv.push(.5+.5*Math.sin(angle)/Math.sin(arc),1-t);
  }
 }
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;indices.push(a,c,b,b,c,d);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function sleeveGeometry(side,longSleeve=false){
 // Taper a tube along the mannequin arm. Long sleeves finish at the wrist;
 // short sleeves finish around the upper arm as a real tee does.
 const start=new THREE.Vector3(side*.37,2.16,0),end=longSleeve?new THREE.Vector3(side*.59,.84,.035):new THREE.Vector3(side*.535,1.52,.015);
 const axis=end.clone().sub(start).normalize(),across=new THREE.Vector3(axis.y,-axis.x,0).normalize();
 const rings=24,radial=32,positions=[],uv=[],indices=[];
 for(let j=-6;j<=rings;j++){
  const t=Math.max(0,j)/rings,center=start.clone().lerp(end,t);
  let radius=longSleeve ? .102+.050*(1-t)+.004*Math.sin(Math.PI*t) : .112+.033*(1-t)+.006*Math.sin(Math.PI*t);
  if(j<0){const cap=-j*Math.PI/12;center.addScaledVector(axis,-.105*Math.sin(cap));radius*=Math.cos(cap);}
  for(let i=0;i<=radial;i++){
   const a=i/radial*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
   positions.push(center.x+across.x*radius*ca,center.y+across.y*radius*ca,center.z+radius*sa);
   uv.push(i/radial,j<0 ? 1+.018*j : 1-t);
  }
 }
 for(let j=0;j<rings+6;j++)for(let i=0;i<radial;i++){const a=j*(radial+1)+i,b=a+1,c=a+radial+1,d=c+1;indices.push(a,c,b,b,c,d);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function sampledFabric(image){
 const [r,g,b]=imageColor(image);
 const fabric=document.createElement('canvas');fabric.width=1024;fabric.height=1024;const ctx=fabric.getContext('2d');
 ctx.fillStyle=`rgb(${r},${g},${b})`;ctx.fillRect(0,0,1024,1024);
 // The catalog photo is mapped separately over the front panel; this map supplies fabric color around transparent areas.
 ctx.globalAlpha=.055;ctx.strokeStyle=r+g+b>390?'#4a4a40':'#fff';ctx.lineWidth=1;
 for(let y=0;y<1024;y+=12){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y);ctx.stroke();}
 for(let x=0;x<1024;x+=12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1024);ctx.stroke();}
 ctx.globalAlpha=1;
 const texture=new THREE.CanvasTexture(fabric);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();texture.needsUpdate=true;return texture;
}
// Extract cloth from the cutout in garment coordinates. The sleeve hem
// slopes in a flat-lay photo, so each source column has its own endpoints.
function armGeometry(side){
 // A single surface through shoulder, elbow and wrist keeps the elbow
 // continuous when it is exposed by a short sleeve.
 const joints=[
  [.37,2.12,.01],[.41,2.04,.095],[.46,1.82,.105],
  [.50,1.54,.087],[.526,1.41,.083],[.55,1.22,.078],
  [.575,.99,.057],[.587,.83,.046],[.59,.79,.041]
 ];
 const positions=[],indices=[],segments=32;
 for(const [x,y,r] of joints){
  for(let n=0;n<=segments;n++){
   const a=n/segments*2*Math.PI;
   positions.push(side*x+r*Math.cos(a),y,.022+r*Math.sin(a));
  }
 }
 for(let j=0;j<joints.length-1;j++)for(let n=0;n<segments;n++){
  const a=j*(segments+1)+n,b=a+1,c=a+segments+1;
  indices.push(a,b,c,b,c+1,c);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function cutoutPanels(image){
 const source=document.createElement('canvas');
 source.width=384;source.height=Math.max(64,Math.min(768,Math.round(384*image.height/image.width)));
 const w=source.width,h=source.height,ctx=source.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(image,0,0,w,h);
 const data=ctx.getImageData(0,0,w,h).data;
 const opaque=(x,y)=>data[(y*w+x)*4+3]>180;
 function extent(limit,inside){
  let lo=0,hi=limit-1;
  while(lo<hi&&!inside(lo))lo++;
  while(hi>lo&&!inside(hi))hi--;
  return [lo,hi];
 }
 const [left,right]=extent(w,x=>opaque(x,Math.floor(h*.75)));
 const [top,bottom]=extent(h,y=>opaque(Math.floor((left+right)/2),y));
 // Measure the sleeve hems in the outer strips, away from the torso.
 const tips=[];
 for(const side of [0,1])for(const fraction of [.08,.1,.12,.14]){
  const x=Math.round((side?1-fraction:fraction)*(w-1));
  const [lo,hi]=extent(h,y=>opaque(x,y));
  if(hi-lo>h*.12)tips.push((hi-top)/Math.max(1,bottom-top));
 }
 tips.sort((a,b)=>a-b);
 const longSleeves=tips.length>=3&&tips[Math.floor(tips.length/2)]>.72;
 const make=(width,height)=>{
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const context=c.getContext('2d');context.fillStyle='rgb('+imageColor(image).join(',')+')';context.fillRect(0,0,width,height);
  return [c,context];
 };
 const texture=c=>{const m=new THREE.CanvasTexture(c);m.colorSpace=THREE.SRGBColorSpace;m.anisotropy=renderer.capabilities.getMaxAnisotropy();return m;};
 const [panel,front]=make(512,768);
 for(let row=0;row<panel.height;row++){
  const t=row/(panel.height-1),fraction=.055+.925*t;
  const y=top+(bottom-top)*fraction;
  const span=Math.min(right-left,longSleeves?w*.66:w)*(.57+.43*THREE.MathUtils.smoothstep(t,0,.16));
  front.drawImage(image,((left+right-span)/2)*image.width/w,y*image.height/h,span*image.width/w,image.height/h,0,row,panel.width,1);
 }
 const sleeves=[left,w-1-right].map((margin,side)=>{
  const [panel,draw]=make(192,384);
  for(let col=0;col<panel.width;col++){
   const u=.5-.5*Math.cos(2*Math.PI*col/panel.width);
   const offset=Math.round((longSleeves?w*.18:margin)*(.46+.39*u));
   const x=side?w-1-offset:offset;
   const [lo,hi]=extent(h,y=>opaque(x,y));
   if(hi-lo<8)continue;
   draw.drawImage(image,x*image.width/w,(lo+2)*image.height/h,image.width/w,(hi-lo-4)*image.height/h,col,0,1,panel.height);
  }
  return texture(panel);
 });
 return {front:texture(panel),sleeves,longSleeves};
}
// Unwrap the widest visible fabric run per row so background gaps between
// crossed legs never become part of the material on the mannequin.
function lowerFabric(image){
 const c=document.createElement('canvas');c.width=160;c.height=256;
 const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);
 const pixels=ctx.getImageData(0,0,c.width,c.height).data;
 const out=c.cloneNode(false),draw=out.getContext('2d');
 draw.fillStyle='rgb('+imageColor(image).join(',')+')';draw.fillRect(0,0,out.width,out.height);
 for(let y=0;y<c.height;y++){
  let start=0,best=0,width=0;
  for(let x=0;x<=c.width;x++){
   if(x<c.width&&pixels[(y*c.width+x)*4+3]>220)continue;
   if(x-start>width){width=x-start;best=start;}
   start=x+1;
  }
  if(width>2)draw.drawImage(c,best+1,y,width-2,1,0,y,out.width,1);
 }
 const map=new THREE.CanvasTexture(out);map.colorSpace=THREE.SRGBColorSpace;return map;
}
function imageColor(image){
 try{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,64,64);const d=ctx.getImageData(0,0,64,64).data;let r=0,g=0,b=0,n=0;for(let y=12;y<54;y++)for(let x=17;x<47;x++){const i=(y*64+x)*4;if(d[i+3]>96){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}}if(n)return [Math.round(r/n),Math.round(g/n),Math.round(b/n)];}catch{}return [140,150,124];
}
function init(){
 renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#e4e8dd');
 const camera=new THREE.PerspectiveCamera(34,canvas.clientWidth/canvas.clientHeight,.1,100);camera.position.set(0,1.78,6.75);
  scene.add(new THREE.HemisphereLight(0xfffbf4,0x89917e,1.55));
  const key=new THREE.DirectionalLight(0xfff1df,2.5);key.position.set(-3,5,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);scene.add(key);
  const fill=new THREE.DirectionalLight(0xdce8ff,1.0);fill.position.set(3,3,-4);scene.add(fill);

  const bodyMaterial=new THREE.MeshPhysicalMaterial({color:'#c7c2b7',roughness:.72,metalness:0,clearcoat:.04,clearcoatRoughness:.9});
 const trouserMaterial=new THREE.MeshStandardMaterial({color:'#74796f',roughness:.82});
 const shoeMaterial=new THREE.MeshStandardMaterial({color:'#424640',roughness:.72});
  // An elliptical torso gives the shirt a shallow body surface to sit over instead of hiding it inside a round body.
  const torso=new THREE.Mesh(bodyGeometry(),bodyMaterial);torso.castShadow=true;torso.receiveShadow=true;scene.add(torso);
 const head=new THREE.Mesh(new THREE.SphereGeometry(1,48,40),bodyMaterial);head.position.set(0,2.80,0);head.scale.set(.205,.265,.185);head.castShadow=true;scene.add(head);
 for(const side of [-1,1]){
  const arm=new THREE.Mesh(armGeometry(side),bodyMaterial);
  arm.castShadow=true;scene.add(arm);
  const hand=new THREE.Mesh(new THREE.SphereGeometry(1,24,18),bodyMaterial);hand.position.set(side*.59,.76,.045);hand.scale.set(.075,.115,.07);hand.castShadow=true;scene.add(hand);
  scene.add(capsule(.132,.64,trouserMaterial,[side*.15,.48,0],side*.018));
  const shoe=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),shoeMaterial);shoe.position.set(side*.15,.09,.075);shoe.scale.set(.13,.085,.24);shoe.castShadow=true;scene.add(shoe);
 }
 shirt=new THREE.Group();shirt.add(new THREE.Mesh(shirtGeometry(),new THREE.MeshPhysicalMaterial({color:'#8c967c',roughness:.86,side:THREE.DoubleSide})));
 shirtMaterial=shirt.children[0].material;
 shirtGraphicMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.86,metalness:0,transparent:false,side:THREE.DoubleSide,depthWrite:true,polygonOffset:true,polygonOffsetFactor:-1});
 shirt.add(new THREE.Mesh(shirtGraphicGeometry(),shirtGraphicMaterial));
 sleeveMaterial=new THREE.MeshStandardMaterial({color:'#8c967c',roughness:.86,side:THREE.DoubleSide});
 const collar=new THREE.Mesh(new THREE.TorusGeometry(.132,.018,10,48),sleeveMaterial);collar.rotation.x=Math.PI/2;collar.position.y=2.414;shirt.add(collar);
 const hem=new THREE.Mesh(new THREE.TorusGeometry(.315,.008,8,64),sleeveMaterial);hem.rotation.x=Math.PI/2;hem.position.y=.89;hem.scale.y=.54;shirt.add(hem);
 for(const side of [-1,1]){const shortSleeve=new THREE.Mesh(sleeveGeometry(side),sleeveMaterial),longSleeve=new THREE.Mesh(sleeveGeometry(side,true),sleeveMaterial);shortSleeve.castShadow=longSleeve.castShadow=true;shortSleeve.receiveShadow=longSleeve.receiveShadow=true;shirt.add(shortSleeve,longSleeve);shortSleeves.push(shortSleeve);longSleeves.push(longSleeve);longSleeve.visible=false;}
 const armMaterials=[sleeveMaterial.clone(),sleeveMaterial.clone()];
 for(let i=0;i<2;i++)shortSleeves[i].material=longSleeves[i].material=armMaterials[i];
 scene.add(shirt);
 // Keep the neck and wrists fixed while changing ease around the trunk.
 const torsoPanels=shirt.children.slice(0,2).map(mesh=>({
  mesh,rest:mesh.geometry.attributes.position.array.slice()
 }));
 function setEase(scale){
  const ease=THREE.MathUtils.clamp(scale-1,-.5,.8);
  for(const {mesh,rest} of torsoPanels){
   const pos=mesh.geometry.attributes.position;
   for(let i=0;i<pos.count;i++){
    const j=i*3,y=rest[j+1],weight=1-THREE.MathUtils.smoothstep(y,1.6,2.22);
    const width=1+weight*ease*(ease < 0 ? .065 : .22);
    pos.setXYZ(i,rest[j]*width,y,rest[j+2]*width);
   }
   pos.needsUpdate=true;mesh.geometry.computeVertexNormals();
  }
  hem.scale.x=1+ease*(ease < 0 ? .065 : .22);
  hem.scale.y=.54*hem.scale.x;
 }
 const waistband=new THREE.Mesh(new THREE.SphereGeometry(1,48,24),trouserMaterial);
 waistband.position.y=.86;waistband.scale.set(.31,.10,.17);scene.add(waistband);


 const floor=new THREE.Mesh(new THREE.CircleGeometry(1.7,64),new THREE.MeshStandardMaterial({color:'#d0d7c7',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=.005;floor.scale.set(1,.5,1);floor.receiveShadow=true;scene.add(floor);
 const shadow=new THREE.Mesh(new THREE.CircleGeometry(.62,48),new THREE.MeshBasicMaterial({color:'#89917d',transparent:true,opacity:.16,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.012,0);shadow.scale.set(1,.48,1);scene.add(shadow);
 controls=new OrbitControls(camera,canvas);controls.target.set(0,1.58,0);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=4.5;controls.maxDistance=8.2;controls.minPolarAngle=Math.PI*.27;controls.maxPolarAngle=Math.PI*.68;
 const resize=new ResizeObserver(()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}});resize.observe(canvas);
 const loader=new THREE.TextureLoader();
 function fabricMap(url){
  const map=loader.load(url);
  map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return map;
 }
 window.ETry3D={
  // The studio garment stays registered to its body. Manual transforms
  // belong to the camera and photo canvases; OrbitControls rotates the view.
  setScale:setEase,setRotation(){},setHeight(){},
  setLower(pants,shoes){
   for(const [material,image,base] of [[trouserMaterial,pants,'#74796f'],[shoeMaterial,shoes,'#424640']]){
    material.map?.dispose();material.map=image?lowerFabric(image):null;
    material.color.set(image?'#ffffff':base);material.needsUpdate=true;
   }
  },
  setVisible(visible){shirt.visible=visible;},
  setTexture(image,type='',id=''){
   for(const material of [shirtMaterial,shirtGraphicMaterial,...armMaterials])material.map?.dispose();
   const original=id==='original';
   shirtMaterial.map=sampledFabric(image);
   const panels=original?null:cutoutPanels(image);
   shirtGraphicMaterial.map=original?fabricMap('/assets/original-torso.webp'):panels.front;
   armMaterials.forEach((material,i)=>{
    material.map=original?fabricMap('/assets/original-sleeve.webp'):panels.sleeves[i];
    material.color.set('#ffffff');material.needsUpdate=true;
   });
   const [r,g,b]=imageColor(image);
   sleeveMaterial.color.setRGB(r/255,g/255,b/255,THREE.SRGBColorSpace);
   
   shirtMaterial.color.set('#ffffff');
   for(const material of [shirtMaterial,shirtGraphicMaterial,sleeveMaterial])material.needsUpdate=true;
   const long=original||panels?.longSleeves||/long sleeve|full sleeve|sweatshirt|hoodie|jacket|coat|sweater/i.test(type);
   shortSleeves.forEach(mesh=>mesh.visible=!long);
   longSleeves.forEach(mesh=>mesh.visible=long);
  },
  reset(){controls.reset();}
 };
 function frame(){requestAnimationFrame(frame);controls.update();renderer.render(scene,camera);}frame();
}
try{init();window.dispatchEvent(new Event('etry3d-ready'));}catch(error){console.error('3D fitting view unavailable',error);canvas.hidden=true;window.dispatchEvent(new Event('etry3d-error'));}
