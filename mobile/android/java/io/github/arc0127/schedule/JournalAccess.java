package io.github.arc0127.schedule;
import android.content.Context;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** One storage transaction for foreground and background synchronization. */
final class JournalAccess implements JournalTransfer.Access {
    interface Query {JSONObject run(String operation,JSONObject payload)throws Exception;}
    interface Guard {void run()throws Exception;}
    static volatile boolean busy;
    private boolean owned;
    private final Context context;
    private final EventStore events;
    private final Query query;
    private final Guard guard;
    private final Runnable ended;
    JournalAccess(Context context,Query query,Guard guard,Runnable ended)throws Exception {
        this.context=context.getApplicationContext();this.events=EventStore.get(context);this.query=query;this.guard=guard;this.ended=ended;
    }
    private File images()throws IOException {File dir=new File(context.getFilesDir(),"images");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Image storage unavailable");return dir;}
            public SyncAssets assets()throws Exception{return new SyncAssets(images());}
            public JSONObject prepare(String source)throws Exception{return prepare(source,false);}
            public JSONObject prepare(String source,boolean batched) throws Exception {
                guard.run();
                synchronized(DataBackup.LOCK) {
                    if(busy)throw new IOException("Finish the current data operation first");
                    events.begin(source);busy=true;owned=true;
                }
                return query.run("export",new JSONObject().put("source",source).put("batched",batched));
            }
            public void apply(String source,JSONObject sent,JSONObject response) throws Exception {
                JSONObject originalAssets=response.getJSONObject("assets");
                for(Iterator<String> it=originalAssets.keys();it.hasNext();){String id=it.next();JSONObject asset=originalAssets.getJSONObject(id);if(asset.optBoolean("ref")&&!assets().has(id))throw new IOException("Missing original: "+id);}
                JSONObject prepared=query.run("apply",new JSONObject().put("sent",sent).put("response",response));
                synchronized(DataBackup.LOCK) {
                    Map<String,byte[]> files=DataBackup.captureMetadata(context);
                    files.put("journal.json",prepared.getJSONObject("journal").toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject remote=Protocol.snapshot(prepared.getJSONArray("events"));
                    JSONObject eventState=new JSONObject().put("local",new JSONObject()).put("remote",remote).put("outbox",new JSONObject()).put("source",source).put("lastSync",System.currentTimeMillis());
                    files.put("events.json",eventState.toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject alarms=DataBackup.json(files.get("alarms.json"));
                    List<String> oldKeys=new ArrayList<>();for(Iterator<String> it=alarms.keys();it.hasNext();)oldKeys.add(it.next());
                    for(String key:oldKeys)if(key.startsWith("local:")&&remote.has(key.substring(6))) {
                        String shared="remote:"+key.substring(6);if(!alarms.has(shared))alarms.put(shared,alarms.get(key));alarms.remove(key);
                    }
                    files.put("alarms.json",alarms.toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject assets=response.getJSONObject("assets");
                    for(Iterator<String> it=assets.keys();it.hasNext();) {
                        String id=it.next();if(!DataBackup.imageName(id))throw new IOException("Invalid image identity");
                        if(assets.getJSONObject(id).optBoolean("ref"))continue;
                        byte[] bytes=android.util.Base64.decode(assets.getJSONObject(id).getString("data"),android.util.Base64.NO_WRAP);
                        if(!id.startsWith(DataBackup.hash(bytes)+"."))throw new IOException("Original image checksum mismatch");
                        files.put("images/"+id,bytes);
                    }
                    DataBackup.commitMetadata(context,files);events.reload();
                }
            }
            public void end() {synchronized(DataBackup.LOCK){if(owned){busy=false;events.end();owned=false;}}ended.run();}
}
