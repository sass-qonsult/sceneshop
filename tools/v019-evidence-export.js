#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
function arg(name) { const prefix=`--${name}=`; const hit=process.argv.find(v=>v.startsWith(prefix)); return hit ? hit.slice(prefix.length) : null; }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyFile(from, outRoot, relative, files) {
  if (!fs.existsSync(from)) return;
  const to = path.join(outRoot, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files.push({ path: relative.replaceAll('\\','/'), bytes: fs.statSync(to).size, sha256: sha256(to) });
}
function latest(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter(n=>n.startsWith(prefix)&&n.endsWith('.json')).map(n=>path.join(dir,n));
  hits.sort((a,b)=>fs.statSync(a).mtimeMs-fs.statSync(b).mtimeMs);
  return hits.at(-1) || null;
}

function main() {
  const outArg = arg('out');
  if (!outArg) throw new Error('--out=<directory> is required');
  const out = path.resolve(ROOT, outArg);
  const pkg = require(path.join(ROOT,'package.json'));
  const gitCommit = cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  fs.mkdirSync(out,{recursive:true});
  const files=[];
  const artifacts=path.join(ROOT,'artifacts');

  const foundation=latest(path.join(artifacts,'foundation-gate'),'foundation-evidence-');
  if (foundation) copyFile(foundation,out,`foundation-gate/${path.basename(foundation)}`,files);
  const recovery=latest(path.join(artifacts,'recovery-gate'),'recovery-evidence-');
  if (recovery) copyFile(recovery,out,`recovery-gate/${path.basename(recovery)}`,files);
  copyFile(path.join(artifacts,'rc-gate','schema-compatibility.json'),out,'rc-gate/schema-compatibility.json',files);
  for (const name of ['desktop.json','android.json','ios.json','android-signed.json','ios-signed.json','android-signature.json','ios-signature.json']) {
    copyFile(path.join(artifacts,'native-build',name),out,`native-build/${name}`,files);
  }
  copyFile(path.join(artifacts,'native-signing','report.json'),out,'native-signing/report.json',files);
  const qaDir=path.join(artifacts,'app-qa','executions');
  if (fs.existsSync(qaDir)) for (const name of fs.readdirSync(qaDir).filter(n=>n.endsWith('.json')).sort()) copyFile(path.join(qaDir,name),out,`app-qa/executions/${name}`,files);

  const index={schemaVersion:1,release:'SceneShop v0.19 external evidence transport',gitCommit,packageVersion:pkg.version,generatedAt:new Date().toISOString(),fileCount:files.length,files};
  fs.writeFileSync(path.join(out,'evidence-index.json'),JSON.stringify(index,null,2)+'\n');
  process.stdout.write(JSON.stringify(index,null,2)+'\n');
  if (!files.length) process.exitCode=2;
}

if(require.main===module){try{main();}catch(e){console.error(e.stack||e.message);process.exitCode=1;}}
