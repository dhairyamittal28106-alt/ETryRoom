/** Repair small occlusions in the shirt front before separating torso and sleeves.
 * Sample along the same fabric column to preserve vertical checks and plackets.
 */
export function repairShirt(shirt, singlePanel=false) {
  const w=shirt.width, h=shirt.height;
  const ctx=shirt.getContext('2d');
  const pixels=ctx.getImageData(0,0,w,h);
  const data=pixels.data;
  const opaque=i=>data[i*4+3]>=100;
  const labels=new Int32Array(w*h);
  const queue=new Int32Array(w*h);
  const sizes=[0];
  for(let start=0;start<labels.length;start++){
    if(labels[start] || !opaque(start))continue;
    const id=sizes.length;
    let end=1;
    queue[0]=start;labels[start]=id;
    const visit=i=>{
      if(!labels[i] && opaque(i)){labels[i]=id;queue[end++]=i;}
    };
    for(let head=0;head<end;head++){
      const i=queue[head],x=i%w;
      if(x)visit(i-1);
      if(x+1<w)visit(i+1);
      if(i>=w)visit(i-w);
      if(i+w<labels.length)visit(i+w);
    }
    sizes.push(end);
  }
  let main=0;
  for(let id=1;id<sizes.length;id++)if(sizes[id]>sizes[main])main=id;
  if(!main)return;
  // Remove isolated misclassified flecks, while retaining substantial panels.
  for(let i=0;i<labels.length;i++){
    if((singlePanel && labels[i]!==main) || (labels[i] && sizes[labels[i]]<sizes[main]*.006))data[i*4+3]=0;
  }
  const first=Math.floor(h*.26),last=Math.floor(h*.92);
  for(let x=Math.floor(w*.18);x<w*.82;x++){
    let y=first;
    while(y<last){
      if(labels[y*w+x]===main){y++;continue;}
      const from=y;
      while(y<last && labels[y*w+x]!==main)y++;
      const gap=y-from;
      if(from===first || y===last || gap>h*.18)continue;
      // Only fill gaps between substantial runs of the same fabric.
      const guard=Math.max(2,Math.ceil(gap*.45));
      if(from-guard<0 || y+guard>=h)continue;
      let continuous=true;
      for(let k=0;k<guard;k++){
        if(labels[(from-1-k)*w+x]!==main || labels[(y+k)*w+x]!==main){continuous=false;break;}
      }
      if(!continuous)continue;
      for(let k=0;k<gap;k++){
        const dst=((from+k)*w+x)*4;
        const above=((from-1-Math.min(k,guard-1))*w+x)*4;
        const below=((y+Math.min(gap-1-k,guard-1))*w+x)*4;
        const sample=k<gap/2?above:below;
        for(let c=0;c<3;c++)data[dst+c]=data[sample+c];
        data[dst+3]=255;
      }
    }
  }
  ctx.putImageData(pixels,0,0);
}
