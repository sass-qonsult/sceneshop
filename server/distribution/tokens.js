const crypto=require('crypto');
const store=require('../store');
const b64=(v)=>Buffer.from(v).toString('base64url');
const secret=()=>process.env.SESSION_SECRET||store.state.secret;
function sign(payload){const body=b64(JSON.stringify(payload));const mac=b64(crypto.createHmac('sha256',secret()).update(body).digest());return`${body}.${mac}`;}
function verify(token,purpose='partner-sdk'){const [body,mac]=String(token||'').split('.');if(!body||!mac)return null;const expected=b64(crypto.createHmac('sha256',secret()).update(body).digest());if(mac.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))return null;try{const p=JSON.parse(Buffer.from(body,'base64url').toString());if(p.purpose!==purpose||Number(p.exp)<Date.now())return null;return p;}catch{return null;}}
function issueSdkToken({organizationId,workId,bindingId,mode,scopes},ttlMs=15*60e3){const now=Date.now();return sign({purpose:'partner-sdk',organizationId,workId,bindingId:bindingId||null,mode,scopes:Array.isArray(scopes)?scopes:[],iat:now,exp:now+ttlMs,nonce:crypto.randomUUID()});}
module.exports={sign,verify,issueSdkToken};
