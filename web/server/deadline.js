export async function within(ms, work) {
  const controller=new AbortController(); let timer;
  try {
    return await Promise.race([work(controller.signal),new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error('Optional context timed out.'));},ms);
    })]);
  } finally {clearTimeout(timer);}
}
