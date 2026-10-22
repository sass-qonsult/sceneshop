const crypto=require('crypto');
function validRequestId(v){return /^[A-Za-z0-9._:-]{8,128}$/.test(String(v||''));}
function middleware(req,res,next){
  const requestId=validRequestId(req.headers['x-request-id'])?String(req.headers['x-request-id']):crypto.randomUUID();
  req.requestId=requestId;res.setHeader('X-Request-Id',requestId);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(self), geolocation=(), microphone=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  const partnerSdk=req.path==='/js/sceneshop-partner-sdk.js';
  res.setHeader('Cross-Origin-Resource-Policy',partnerSdk?'cross-origin':'same-site');
  if(partnerSdk)res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self' ws: wss:; form-action 'self'; frame-ancestors 'self'");
  if(process.env.NODE_ENV==='production'&&(req.secure||String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https'))res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
}
module.exports={middleware,validRequestId};
