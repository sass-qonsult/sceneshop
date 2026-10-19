#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args=Object.fromEntries(process.argv.slice(2).map((v)=>{const [k,...rest]=v.replace(/^--/,'').split('=');return [k,rest.join('=')||true];}));
const base=String(args.base||process.env.SCENESHOP_APP_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const url=new URL('/desktop',base);
const deepLink=String(args.deeplink||args.deepLink||'');
if(deepLink.startsWith('sceneshop://session/')) args.code=decodeURIComponent(deepLink.slice('sceneshop://session/'.length));
else if(deepLink) args.source=deepLink;
if(args.code) url.searchParams.set('code',String(args.code).toUpperCase());
if(args.source) url.searchParams.set('source',String(args.source));
if(!['https:','http:'].includes(url.protocol)) throw new Error('SceneShop desktop only allows http(s) application origins');
if(url.protocol==='http:'&&!['127.0.0.1','localhost'].includes(url.hostname)&&process.env.SCENESHOP_ALLOW_INSECURE!=='1') throw new Error('Non-local SceneShop desktop origins must use HTTPS');

const candidates=process.platform==='win32'
  ? [
      process.env.SCENESHOP_BROWSER,
      'msedge.exe',
      'chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA||'','Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env.LOCALAPPDATA||'','Google\\Chrome\\Application\\chrome.exe')
    ].filter(Boolean)
  : process.platform==='darwin'
    ? [process.env.SCENESHOP_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : [process.env.SCENESHOP_BROWSER,'chromium','chromium-browser','google-chrome','microsoft-edge'];

function exists(command){
  if(!command) return false;
  if(command.includes(path.sep)) return fs.existsSync(command);
  const dirs=String(process.env.PATH||'').split(path.delimiter);
  return dirs.some((dir)=>fs.existsSync(path.join(dir,command)));
}
const browser=candidates.find(exists);
if(!browser) throw new Error('No supported Chromium-based desktop runtime found. Set SCENESHOP_BROWSER.');
const profile=path.join(os.homedir(),'.sceneshop','desktop-profile');
fs.mkdirSync(profile,{recursive:true});
const browserArgs=[`--app=${url.toString()}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-default-apps'];
if(args['dry-run']||args.dryRun){console.log(JSON.stringify({browser,args:browserArgs,url:url.toString()}));process.exit(0);}
const child=spawn(browser,browserArgs,{stdio:'inherit',detached:false});
child.on('exit',(code,signal)=>{ if(signal) process.kill(process.pid,signal); process.exit(code??0); });
