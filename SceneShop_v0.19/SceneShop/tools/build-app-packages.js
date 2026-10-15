#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..');const pkg=require(path.join(ROOT,'package.json'));
const OUT=path.join(ROOT,'artifacts','app-packages',pkg.version);
fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(ROOT,src),dst);}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function zipFolder(name,folder){const out=path.join(OUT,name);cp.execFileSync('zip',['-qr',out,'.'],{cwd:folder});return out;}
const stage=path.join(OUT,'stage');fs.mkdirSync(stage,{recursive:true});
const desktop=path.join(stage,'desktop');for(const f of ['launcher.mjs','sceneshop.desktop','install-linux.sh','install-windows.ps1','install-macos.command'])copy(`apps/desktop/${f}`,path.join(desktop,f));copy('public/media/app/sceneshop-512.png',path.join(desktop,'sceneshop-512.png'));
const android=path.join(stage,'android');cp.execFileSync('cp',['-R',path.join(ROOT,'apps/mobile/android/.') ,android]);
const ios=path.join(stage,'ios');cp.execFileSync('cp',['-R',path.join(ROOT,'apps/mobile/ios/.') ,ios]);
const outputs=[
  zipFolder(`SceneShop_Desktop_Host_${pkg.version}.zip`,desktop),
  zipFolder(`SceneShop_Android_Source_${pkg.version}.zip`,android),
  zipFolder(`SceneShop_iOS_Source_${pkg.version}.zip`,ios),
];
const sums=outputs.map(f=>`${hash(f)}  ${path.basename(f)}`).join('\n')+'\n';fs.writeFileSync(path.join(OUT,'SHA256SUMS.txt'),sums);
fs.rmSync(stage,{recursive:true,force:true});
console.log(JSON.stringify({version:pkg.version,outputs:outputs.map(f=>({file:f,sha256:hash(f)}))},null,2));
