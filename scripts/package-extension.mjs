import {cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
const dest = 'etry_extension';
const built = 'public/static';
for (const [source,target] of [['assets','static/assets'],['parser','static/parser'],['models','models'],['vision-wasm','vision-wasm']]) {
  mkdirSync(dest+'/'+target,{recursive:true});
  cpSync(built+'/'+source,dest+'/'+target,{recursive:true});
}
mkdirSync(dest+'/assets',{recursive:true});
for (const texture of ['shirt.png','original-torso.webp','original-sleeve.webp']) cpSync('assets/'+texture,dest+'/assets/'+texture);
const html = readFileSync(built+'/index.html','utf8');
writeFileSync(dest+'/static/index.html',html.replace('</body>', '<script src="/content.js" defer></script></body>'));

cpSync(built+'/panel.html',dest+'/static/panel.html');
