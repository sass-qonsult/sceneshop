#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawn}=require('child_process');
const fp=require('../public/js/sync-fingerprint.js');

function usage(){console.error('Uso: node tools/build-sync-index.js <video> [--sync-id SYNC-...] [--out manifest.json]');process.exit(2);}
const args=process.argv.slice(2); if(!args[0]||args[0].startsWith('--'))usage();
const file=path.resolve(args[0]); if(!fs.existsSync(file))throw new Error('Arquivo não encontrado.');
const opt=(name,def=null)=>{const i=args.indexOf(name);return i>=0?args[i+1]:def;};
const outFile=opt('--out',null); const syncId=opt('--sync-id',`SYNC-${crypto.createHash('sha256').update(file).digest('hex').slice(0,20).toUpperCase()}`);
const sourceSha=crypto.createHash('sha256'); const src=fs.createReadStream(file); src.on('data',d=>sourceSha.update(d));
const chunks=[];
const ff=spawn('ffmpeg',['-v','error','-i',file,'-vn','-ac','1','-ar',String(fp.TARGET_RATE),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','inherit']});
ff.stdout.on('data',d=>chunks.push(d));
ff.on('error',e=>{throw e;});
ff.on('close',code=>{
  if(code!==0)process.exit(code||1);
  const buf=Buffer.concat(chunks); const pcm=new Float32Array(buf.length/4);
  for(let i=0;i<pcm.length;i++)pcm[i]=buf.readFloatLE(i*4);
  const windows=fp.fingerprint(pcm,fp.TARGET_RATE);
  const duration=pcm.length/fp.TARGET_RATE;
  const manifest={format:'sceneshop-sync-index',version:1,syncId,algorithm:'SS-AUDIO-SPECTRAL',algorithmVersion:1,sourceSha256:sourceSha.digest('hex'),duration:Number(duration.toFixed(3)),windows};
  const text=JSON.stringify(manifest,null,2);
  if(outFile)fs.writeFileSync(path.resolve(outFile),text); else process.stdout.write(text+'\n');
});
