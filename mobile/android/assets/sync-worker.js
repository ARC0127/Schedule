'use strict';
async function syncWorker(id,operation,payload) {
  try {
    const value=await syncOperation(operation,payload,(name,arg='')=>{
      const reply=JSON.parse(SyncNative.read(name,arg));
      if(!reply.ok)throw Error(reply.error);
      return reply.value;
    });
    SyncNative.reply(id,JSON.stringify({ok:true,value}));
  }catch(error){SyncNative.reply(id,JSON.stringify({ok:false,error:error.message}));}
}
SyncNative.ready();
