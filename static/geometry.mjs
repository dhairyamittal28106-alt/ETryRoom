export function fitFromPose(l, w, h, mirrored=false) {
  if (!l || ![11,12,23,24].every(i=>l[i]&&(l[i].visibility??1)>.5)) return null;
  const p=i=>({x:(mirrored?1-l[i].x:l[i].x)*w,y:l[i].y*h});
  const a=p(11),b=p(12),c=p(23),d=p(24),left=a.x<b.x?a:b,right=a.x<b.x?b:a;
  const shoulderWidth=Math.hypot(right.x-left.x,right.y-left.y);
  if(shoulderWidth<25)return null;
  const hipWidth=Math.hypot(d.x-c.x,d.y-c.y),shoulderX=(a.x+b.x)/2,shoulderY=(a.y+b.y)/2,hipY=(c.y+d.y)/2;
  const leftHip=c.x<d.x?c:d,rightHip=c.x<d.x?d:c;
  const visiblePoint=i=>l[i]&&(l[i].visibility??1)>.35?p(i):null;
  const arms=(a.x<b.x?[[13,15],[14,16]]:[[14,16],[13,15]]).map(pair=>pair.map(visiblePoint));
  const legs={};
  for(const [side,index] of [['left',c.x<d.x?0:1],['right',c.x<d.x?1:0]]){
   for(const [joint,base] of [['Knee',25],['Ankle',27],['Toe',31]]){
    const point=visiblePoint(base+index);
    legs[side+joint+'X']=point?.x;legs[side+joint+'Y']=point?.y;
   }
  }
  return {...legs,x:shoulderX,y:shoulderY+(hipY-shoulderY)*.40,width:Math.max(shoulderWidth*1.36,hipWidth*1.45),shoulderWidth,angle:Math.atan2(right.y-left.y,right.x-left.x),leftShoulderX:left.x,leftShoulderY:left.y,rightShoulderX:right.x,rightShoulderY:right.y,leftElbowX:arms[0]?.[0]?.x,leftElbowY:arms[0]?.[0]?.y,rightElbowX:arms[1]?.[0]?.x,rightElbowY:arms[1]?.[0]?.y,leftWristX:arms[0]?.[1]?.x,leftWristY:arms[0]?.[1]?.y,rightWristX:arms[1]?.[1]?.x,rightWristY:arms[1]?.[1]?.y,leftHipX:leftHip.x,leftHipY:leftHip.y,rightHipX:rightHip.x,rightHipY:rightHip.y};
}
export function containRect(sw,sh,w,h){const r=Math.min(w/sw,h/sh);return{x:(w-sw*r)/2,y:(h-sh*r)/2,width:sw*r,height:sh*r};}
export function smoothFit(a,b,t=.25){return a?Object.fromEntries(Object.keys(b).map(k=>[k,Number.isFinite(b[k])&&Number.isFinite(a[k])?a[k]+(b[k]-a[k])*t:b[k]])):b;}
export function offsetFit(fit,x,y){return Object.fromEntries(Object.entries(fit).map(([key,value])=>[key,typeof value==='number'?value+(key==='x'||key.endsWith('X')?x:key==='y'||key.endsWith('Y')?y:0):value]));}
