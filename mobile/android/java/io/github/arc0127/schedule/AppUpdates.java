package io.github.arc0127.schedule;

import android.app.Activity;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;
import org.json.*;

final class AppUpdates {
    static final String LATEST="https://api.github.com/repos/ARC0127/Schedule/releases/latest";
    private static AppUpdates instance;
    static synchronized AppUpdates get(Context context){if(instance==null)instance=new AppUpdates(context.getApplicationContext());return instance;}
    private final Context context;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private JSONObject candidate;
    private String phase="idle",error="";
    private int percent;
    private boolean busy,ready;
    private AppUpdates(Context context){this.context=context;}
    static File apk(Context context){return new File(context.getCacheDir(),"updates/update.apk");}
    synchronized JSONObject state()throws Exception {
        return new JSONObject().put("current",context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName)
            .put("phase",phase).put("busy",busy).put("available",candidate!=null).put("ready",ready).put("percent",percent).put("error",error)
            .put("version",candidate==null?"":candidate.getString("version")).put("notes",candidate==null?"":candidate.getString("notes"));
    }
    private synchronized void publish(String phase){this.phase=phase;try{SyncService.notifyUi("update",state());}catch(Exception error){android.util.Log.w("ScheduleUpdate","Cannot report update status",error);}}
    synchronized void start(boolean download) {
        if(busy)return;
        if(download&&candidate==null){error="请先检查更新 / Check for updates first";publish("error");return;}
        busy=true;error="";ready=false;percent=0;if(!download)candidate=null;publish(download?"downloading":"checking");
        worker.execute(()->{
            try {
                if(download){download();synchronized(this){busy=false;ready=true;}publish("ready");}
                else {
                    String current=context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName;
                    JSONObject found=select(new JSONObject(readMetadata()),current);
                    synchronized(this){candidate=found;busy=false;}publish(found==null?"current":"available");
                }
            }catch(Exception failure){synchronized(this){busy=false;error=String.valueOf(failure.getMessage());}publish("error");}
        });
    }
    static int compare(String left,String right)throws IOException {
        if(!left.matches("[0-9]+\\.[0-9]+\\.[0-9]+")||!right.matches("[0-9]+\\.[0-9]+\\.[0-9]+"))throw new IOException("Invalid application version");
        String[] a=left.split("\\."),b=right.split("\\.");for(int i=0;i<3;i++){int result=Integer.compare(Integer.parseInt(a[i]),Integer.parseInt(b[i]));if(result!=0)return result;}return 0;
    }
    static JSONObject select(JSONObject release,String current)throws Exception {
        if(release.getBoolean("draft")||release.getBoolean("prerelease"))return null;
        JSONObject selected=null;JSONArray assets=release.getJSONArray("assets");String tag=release.getString("tag_name");
        for(int i=0;i<assets.length();i++){
            JSONObject asset=assets.getJSONObject(i);String name=asset.getString("name");Matcher match=Pattern.compile("Schedule\\.Android-([0-9]+\\.[0-9]+\\.[0-9]+)\\.apk").matcher(name);
            if(!match.matches()||compare(match.group(1),current)<=0)continue;
            String url=asset.getString("browser_download_url"),digest=asset.optString("digest");long size=asset.getLong("size");
            String expected="https://github.com/ARC0127/Schedule/releases/download/"+Uri.encode(tag)+"/"+name;
            if(!expected.equals(url)||!digest.matches("sha256:[a-f0-9]{64}")||size<1||size>256L*1024*1024)throw new IOException("Invalid release asset or checksum");
            if(selected==null||compare(match.group(1),selected.getString("version"))>0)selected=new JSONObject().put("version",match.group(1)).put("url",url).put("digest",digest.substring(7)).put("size",size).put("notes",release.optString("body"));
        }
        return selected;
    }
    private static HttpURLConnection open(String address)throws Exception {
        URL url=new URL(address);
        for(int hop=0;hop<6;hop++) {
            if(!url.getProtocol().equals("https")||!Arrays.asList("api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(url.getHost())||(url.getPort()!=-1&&url.getPort()!=443))throw new IOException("Unsupported update redirect");
            HttpURLConnection connection=(HttpURLConnection)url.openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("User-Agent","Schedule-Updater");
            int code=connection.getResponseCode();
            if(code>=300&&code<400){String location=connection.getHeaderField("Location");connection.disconnect();url=new URL(url,location);continue;}
            if(code!=200){connection.disconnect();throw new IOException("GitHub update request failed ("+code+")");}return connection;
        }
        throw new IOException("Too many update redirects");
    }
    private static String readMetadata()throws Exception {
        HttpURLConnection connection=open(LATEST);
        try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] buffer=new byte[16384];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>2*1024*1024)throw new IOException("Release metadata exceeds limit");bytes.write(buffer,0,n);}return bytes.toString("UTF-8");
        }finally{connection.disconnect();}
    }
    private void download()throws Exception {
        File target=apk(context),partial=new File(target.getPath()+".part");if(!target.getParentFile().isDirectory()&&!target.getParentFile().mkdirs())throw new IOException("Cannot create update cache");
        HttpURLConnection connection=open(candidate.getString("url"));
        try {
            try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(partial)){
                byte[] buffer=new byte[65536];long total=0,size=candidate.getLong("size");int n;
                while((n=input.read(buffer))!=-1){total+=n;if(total>size)throw new IOException("Unexpected update length");output.write(buffer,0,n);int next=(int)(total*100/size);if(next!=percent){percent=next;publish("downloading");}}
                if(total!=size)throw new IOException("Update download incomplete");output.getFD().sync();
            }
            validate(partial,candidate);Files.move(partial.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);
        }finally{connection.disconnect();partial.delete();}
    }
    void validate(File file,JSONObject candidate)throws Exception {
        if(file.length()!=candidate.getLong("size")||!SyncAssets.hash(file).equals(candidate.getString("digest")))throw new IOException("Update checksum mismatch");
        PackageManager manager=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=manager.getPackageArchiveInfo(file.getPath(),flags),installed=manager.getPackageInfo(context.getPackageName(),flags);
        if(archive==null||!context.getPackageName().equals(archive.packageName)||!candidate.getString("version").equals(archive.versionName)||compare(archive.versionName,installed.versionName)<=0||code(archive)<=code(installed))throw new IOException("APK package or version does not match the update");
        Signature[] a=Build.VERSION.SDK_INT>=28?archive.signingInfo.getApkContentsSigners():archive.signatures,b=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
        if(!sameCertificates(a,b))throw new IOException("APK signing identity differs from the installed app");
    }
    static boolean sameCertificates(Signature[] a,Signature[] b){return a!=null&&b!=null&&a.length>0&&b.length>0&&new HashSet<>(Arrays.asList(a)).equals(new HashSet<>(Arrays.asList(b)));}
    private static long code(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    synchronized void install(Activity activity)throws Exception {
        if(busy||!ready||candidate==null)throw new IOException("Download and verify the update first");
        if(JournalAccess.busy)throw new IOException("正在同步，请稍后安装 / Wait for synchronization to finish");
        if(!context.getPackageManager().canRequestPackageInstalls()){
            launch(activity,new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName())));return;
        }
        validate(apk(context),candidate);
        Uri uri=Uri.parse("content://"+context.getPackageName()+".updates/update.apk");
        launch(activity,new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    }
    private void launch(Activity activity,Intent intent){activity.runOnUiThread(()->{try{activity.startActivity(intent);}catch(RuntimeException failure){synchronized(this){error=String.valueOf(failure.getMessage());}publish("error");}});}
}
