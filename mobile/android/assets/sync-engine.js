'use strict';
async function syncOperation(operation,payload,call) {
    const model=ScheduleSyncModel;let value;
    let state=Object.assign(Journal.blank(),call('load')),events=call('entries');
    if(operation==='export') {
      state=Object.assign(Journal.blank(),call('load'));events=call('entries');
      if(state._sync?.source&&state._sync.source!==payload.source)throw Error('This journal is linked to another computer');
      const exported=await model.phoneExport(state,events.events,id=>call(payload.batched?'imageDescriptor':'imageData',id));
      const base=model.copy(state._sync?.base||{});
      if(!state._sync) {
        const raw=call('syncState');
        for(const [key,event] of Object.entries(raw.remote))base['event/'+key]=event;
        for(const [key,change] of Object.entries(raw.outbox)) {
          if(change.base)base['event/'+key]=change.base;else delete base['event/'+key];
        }
      }
      value={schema:2,source:payload.source,base,...exported};
    } else if(operation==='apply') {
      const {sent,response}=payload;
      if(response.schema!==2||response.source!==sent.source)throw Error('Journal source mismatch');
      model.validate(response.entities);await model.validateAssets(response.assets,response.entities);
      const accepted=model.accept(sent.base,sent.entities,response);
      const journal=model.phoneImport(accepted.entities,state,{source:sent.source,base:accepted.base,conflicts:accepted.conflicts});
      value={journal,events:Object.entries(accepted.entities).filter(([key])=>key.startsWith('event/')).map(([,value])=>value)};
    } else throw Error('Unsupported journal operation');
    return value;
}
