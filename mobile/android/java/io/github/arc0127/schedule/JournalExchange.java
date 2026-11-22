package io.github.arc0127.schedule;

import java.io.*;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

final class JournalExchange {
    static void run(InputStream in,OutputStream out,JSONObject hello,JournalTransfer.Access journal,Runnable updated,Consumer<String> status)throws Exception {
        String source=Protocol.string(hello,"source");
        String phase="prepare";
        try {
            boolean batched=hello.optInt("assetSync")>=2 && journal.assets()!=null;
            status.accept("syncing");JSONObject sent=journal.prepare(source,batched).put("reviewSupport",1);
            JSONObject changes=Protocol.frame("changes").put("items",new JSONArray()).put("journalSync",2);
            boolean incremental=hello.optInt("assetSync")>=1;if(incremental)changes.put("assetSync",batched?2:1);
            Protocol.write(out,changes);
            JSONObject wire=sent;JSONArray known=new JSONArray();
            if(incremental) {
                known=Protocol.read(in,"asset-inventory").getJSONArray("ids");
                wire=batched?shallowCopy(sent).put("knownAssets",journal.assets().inventory()):missingAssets(sent,known);
            }
            phase="send-records";JournalTransfer.write(out,wire);
            if(batched){phase="send-images";journal.assets().send(out,in,sent.getJSONObject("assets"),known,status);}
            phase="receive-records";JSONObject response=JournalTransfer.read(in);
            if(batched){phase="receive-images";journal.assets().receive(in,out,response.optJSONObject("assets")==null?new JSONObject():response.getJSONObject("assets"),status);}
            if(response.has("assets")) {
                JSONObject available=shallowCopy(sent.getJSONObject("assets")),received=response.getJSONObject("assets");
                for(Iterator<String> it=received.keys();it.hasNext();){String id=it.next();available.put(id,received.get(id));}
                response.put("assets",available);
            }
            phase="save-records";boolean applied=JournalTransfer.accept(source,sent,response,journal);
            Protocol.write(out,Protocol.frame("ack").put("source",source));
            if(applied)updated.run();status.accept(applied?"synced":"review");
        }catch(Exception error){try{Protocol.write(out,Protocol.frame("sync-error").put("phase",phase).put("message",String.valueOf(error.getMessage())));}catch(Exception ignored){}throw new IOException("Sync failed at "+phase+": "+error.getMessage(),error);}
        finally{journal.end();}
    }
    static JSONObject missingAssets(JSONObject sent,JSONArray ids)throws JSONException {
        Set<String> known=new HashSet<>();for(int i=0;i<ids.length();i++)known.add(ids.getString(i));
        JSONObject wire=shallowCopy(sent),all=sent.getJSONObject("assets"),missing=new JSONObject();JSONArray inventory=new JSONArray();
        for(Iterator<String> it=all.keys();it.hasNext();){String id=it.next();inventory.put(id);if(!known.contains(id))missing.put(id,all.get(id));}
        return wire.put("assets",missing).put("knownAssets",inventory);
    }
    static JSONObject shallowCopy(JSONObject value)throws JSONException {
        JSONObject copy=new JSONObject();for(Iterator<String> it=value.keys();it.hasNext();){String key=it.next();copy.put(key,value.get(key));}return copy;
    }
}
