#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');const arg=(name)=>{const x=process.argv.find(v=>v.startsWith(`--${name}=`));return x?x.slice(name.length+3):null;};
const platform=String(arg('platform')||'').toLowerCase();const artifactArg=arg('artifact');const outArg=arg('out');const signed=process.argv.includes('--signed');const signatureEvidenceArg=arg('signature-evidence');
if(!['android','ios','desktop'].includes(platform)) throw new Error('platform must be android, ios or desktop');
if(!artifactArg) throw new Error('--artifact is required');
if(signed&&platform==='desktop') throw new Error('--signed is reserved for Android/iOS production artifacts');
if(signed&&!signatureEvidenceArg) throw new Error('--signed requires --signature-evidence=<verified-signature.json>');
const artifact=path.resolve(ROOT,artifactArg);if(!fs.existsSync(artifact)||!fs.statSync(artifact).isFile()) throw new Error(`artifact not found: ${artifact}`);
const gitCommit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();const packageVersion=require(path.join(ROOT,'package.json')).version;
const data=fs.readFileSync(artifact);const artifactSha256=crypto.createHash('sha256').update(data).digest('hex');
let signatureVerification=null;
if(signed){
  const proofPath=path.resolve(ROOT,signatureEvidenceArg);if(!fs.existsSync(proofPath))throw new Error(`signature evidence not found: ${proofPath}`);
  const proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));const reasons=[];
  if(proof.ok!==true)reasons.push('signature proof did not report ok=true');
  if(proof.platform!==platform)reasons.push(`platform mismatch: ${proof.platform||'missing'} != ${platform}`);
  if(proof.gitCommit!==gitCommit)reasons.push(`gitCommit mismatch: ${proof.gitCommit||'missing'} != ${gitCommit}`);
  if(proof.packageVersion!==packageVersion)reasons.push(`packageVersion mismatch: ${proof.packageVersion||'missing'} != ${packageVersion}`);
  if(proof.artifact?.sha256!==artifactSha256)reasons.push('signature proof artifact SHA-256 mismatch');
  if(!proof.verification?.verifier||!proof.verification?.identity)reasons.push('signature proof verifier/identity missing');
  if(reasons.length)throw new Error(`invalid signature evidence: ${reasons.join('; ')}`);
  signatureVerification={verified:true,verifier:proof.verification.verifier,identityType:proof.verification.identityType||null,identity:proof.verification.identity,proofArtifactSha256:proof.artifact.sha256};
}
const evidence={schemaVersion:1,gate:`SceneShop ${packageVersion} ${platform} build`,ok:true,platform,signed,signatureVerified:Boolean(signatureVerification?.verified),signatureVerification,gitCommit,packageVersion,generatedAt:new Date().toISOString(),runner:{os:process.env.RUNNER_OS||process.platform,arch:process.arch},artifact:{name:path.basename(artifact),bytes:data.length,sha256:artifactSha256}};
const text=JSON.stringify(evidence,null,2)+'\n';if(outArg){const out=path.resolve(ROOT,outArg);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,text);}process.stdout.write(text);
