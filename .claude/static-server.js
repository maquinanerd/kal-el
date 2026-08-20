const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.join(__dirname,'..','design-import');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  const u=url.parse(req.url,true);
  let p=decodeURIComponent(u.pathname);
  if(p==='/')p='/Kal El.dc.html';
  const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)){res.writeHead(403);return res.end('no');}
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404);return res.end('404 '+p);}
    const ext=path.extname(f).toLowerCase();
    if(ext==='.html' && u.query.theme){
      d=Buffer.from(String(d).replace('<html>','<html data-theme="'+String(u.query.theme).replace(/[^a-z]/g,'')+'">'),'utf8');
    }
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(d);
  });
}).listen(4319,()=>console.log('serving',ROOT,'on http://localhost:4319'));
