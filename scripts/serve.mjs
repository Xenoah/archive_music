import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.jpg':'image/jpeg','.png':'image/png','.txt':'text/plain'};
createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname),p=path.resolve(root,'.'+relative+(relative.endsWith('/')?'index.html':''));
  if(!p.startsWith(root+path.sep))throw new Error('Invalid path');
  const data=await fs.readFile(p);res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
  if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416);res.end();return;}
    const start=Number(match[1]),end=Math.min(data.length-1,match[2]?Number(match[2]):data.length-1);if(start>end){res.writeHead(416);res.end();return;}
    res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1));
  }else{res.setHeader('Content-Length',data.length);res.end(data);}
}catch{res.writeHead(404);res.end('Not found');}}).listen(Number(process.env.PORT)||Number(process.argv[process.argv.indexOf('--port')+1])||3000,'0.0.0.0',()=>console.log('Music preview ready'));
