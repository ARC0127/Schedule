package io.github.arc0127.schedule;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import android.util.AtomicFile;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Runs the shared merge model without an Activity or editable DOM. */
final class SyncEngine implements AutoCloseable {
    private final Context context;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final CompletableFuture<Boolean> ready=new CompletableFuture<>();
    private final Map<String,CompletableFuture<JSONObject>> replies=new ConcurrentHashMap<>();
    private final WebView web;
    SyncEngine(Context context) {
        this.context=context.getApplicationContext();
        web=new WebView(this.context);web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(),"SyncNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
                Uri uri=request.getUrl();String path=uri.getPath();
                try {
                    if(!"https".equals(uri.getScheme())||!"schedule.local".equals(uri.getHost())||
                       !Arrays.asList("/sync-worker.html","/sync-worker.js","/sync-engine.js","/sync.js","/journal.js").contains(path))throw new IOException();
                    return new WebResourceResponse(path.endsWith(".js")?"application/javascript":"text/html","UTF-8",context.getAssets().open(path.substring(1)));
                }catch(Exception error){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
            }
        });
        web.loadUrl("https://schedule.local/sync-worker.html");
    }
    JSONObject query(String operation,JSONObject payload)throws Exception {
        ready.get(30,TimeUnit.SECONDS);
        String id=UUID.randomUUID().toString();CompletableFuture<JSONObject> result=new CompletableFuture<>();replies.put(id,result);
        ui.post(()->web.evaluateJavascript("syncWorker("+JSONObject.quote(id)+","+JSONObject.quote(operation)+","+payload+")",null));
        try{return result.get(90,TimeUnit.SECONDS);}finally{replies.remove(id);}
    }
    public void close(){for(CompletableFuture<JSONObject> reply:replies.values())reply.completeExceptionally(new IOException("Sync engine stopped"));web.destroy();}
    private final class Bridge {
        @JavascriptInterface public void ready(){ready.complete(true);}
        @JavascriptInterface public void reply(String id,String value){
            CompletableFuture<JSONObject> result=replies.get(id);if(result==null)return;
            try {JSONObject json=new JSONObject(value);if(!json.getBoolean("ok"))throw new IOException(json.getString("error"));result.complete(json.getJSONObject("value"));}
            catch(Exception error){result.completeExceptionally(error);}
        }
        @JavascriptInterface public String read(String operation,String argument){
            try {
                Object value;
                synchronized(DataBackup.LOCK){
                    EventStore events=EventStore.get(context);
                    if(operation.equals("load")) {
                        try{value=new JSONObject(new String(new AtomicFile(new File(context.getFilesDir(),"journal.json")).readFully(),StandardCharsets.UTF_8));}
                        catch(FileNotFoundException missing){value=new JSONObject();}
                    }else if(operation.equals("entries"))value=events.details();
                    else if(operation.equals("syncState"))value=events.raw();
                    else if(operation.equals("imageDescriptor"))value=new SyncAssets(new File(context.getFilesDir(),"images")).describe(argument);
                    else if(operation.equals("imageData")) {
                        SyncAssets assets=new SyncAssets(new File(context.getFilesDir(),"images"));JSONObject info=assets.describe(argument);
                        value="data:"+info.getString("mime")+";base64,"+android.util.Base64.encodeToString(java.nio.file.Files.readAllBytes(assets.file(info.getString("id")).toPath()),android.util.Base64.NO_WRAP);
                    }
                    else throw new IOException("Unsupported background operation");
                }
                return new JSONObject().put("ok",true).put("value",value).toString();
            }catch(Exception error){return "{\"ok\":false,\"error\":"+JSONObject.quote(String.valueOf(error.getMessage()))+"}";}
        }
    }
}
