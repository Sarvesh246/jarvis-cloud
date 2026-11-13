import { spawn } from "node:child_process";
import { createServer } from "node:net";
const reserve=createServer();
await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
try {
  let ready=false;
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null) throw new Error('Local preview exited.');
    try {if((await fetch(origin)).ok){ready=true;break;}} catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready) throw new Error('Local preview did not start.');
  const child=spawn(process.execPath,[`scripts/${process.argv[2]}`],{stdio:'inherit',env:{...process.env,CHAT_TEST_URL:origin,TABLE_TEST_URL:origin}});
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
} finally {server.kill();}
