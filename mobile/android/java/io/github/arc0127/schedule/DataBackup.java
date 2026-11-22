package io.github.arc0127.schedule;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Complete app-owned data, including binary originals. External documents stay external. */
final class DataBackup {
    static final Object LOCK = new Object();
    private static final int MAX_FILE = 100 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024;
    static boolean imageName(String value) {
        return value.matches("(?:[a-f0-9-]{36}|[a-f0-9]{64})\\.(png|jpeg|gif|webp|avif|bmp|heic|heif)");
    }
    static byte[] read(InputStream in, int maximum) throws IOException {
        if(in==null)throw new IOException("Could not open the file");
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[32768];
        for(int n;(n=in.read(buffer))!=-1;) {if(out.size()+n>maximum)throw new IOException("File is too large");out.write(buffer,0,n);}
        return out.toByteArray();
    }
    static String hash(byte[] bytes) throws Exception {
        StringBuilder text=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();
    }
    static void write(File file, byte[] bytes) throws IOException {
        File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create data directory");
        AtomicFile atomic=new AtomicFile(file);FileOutputStream out=atomic.startWrite();
        try {out.write(bytes);atomic.finishWrite(out);}catch(Exception e){atomic.failWrite(out);throw e;}
    }
    static byte[] load(File file, String fallback) throws IOException {
        try{return new AtomicFile(file).readFully();}catch(FileNotFoundException e){return fallback.getBytes(StandardCharsets.UTF_8);}
    }
    static JSONObject json(byte[] bytes) throws Exception {return new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
    static void validate(Map<String,byte[]> files) throws Exception {validate(files,null);}
    static void validate(Map<String,byte[]> files,File root) throws Exception {
        long total=0;for(byte[] bytes:files.values()){total+=bytes.length;if(bytes.length>MAX_FILE||total>MAX_TOTAL)throw new IOException("Backup exceeds supported size (100 MiB per file, 256 MiB total)");}
        if(!files.containsKey("journal.json")||!files.containsKey("events.json"))throw new IOException("Incomplete Schedule backup");
        JSONObject journal=json(files.get("journal.json"));
        if(journal.has("ideas")&&!(journal.get("ideas") instanceof JSONArray)||journal.has("days")&&!(journal.get("days") instanceof JSONObject)
                ||journal.has("projects")&&!(journal.get("projects") instanceof JSONArray))throw new IOException("Invalid journal");
        JSONObject events=json(files.get("events.json"));
        for(String scope:new String[]{"local","remote"}) {
            JSONObject rows=events.getJSONObject(scope);
            for(Iterator<String> it=rows.keys();it.hasNext();) {String key=it.next();if(!key.equals(Protocol.event(rows.getJSONObject(key)).getString("key")))throw new IOException("Event key mismatch");}
        }
        JSONObject outbox=events.getJSONObject("outbox");
        for(Iterator<String> it=outbox.keys();it.hasNext();) {
            String key=Protocol.checkedKey(it.next());JSONObject row=outbox.getJSONObject(key);
            if(!key.equals(row.getString("key")))throw new IOException("Outbox key mismatch");
            for(String field:new String[]{"base","value"})if(!row.isNull(field)&&!key.equals(Protocol.event(row.getJSONObject(field)).getString("key")))throw new IOException("Outbox event mismatch");
        }
        events.getString("source");events.getLong("lastSync");
        if(files.containsKey("alarms.json")) {
            JSONObject alarms=json(files.get("alarms.json"));
            for(Iterator<String> it=alarms.keys();it.hasNext();) {Object value=alarms.get(it.next());if(!(value instanceof Boolean)&&!(value instanceof Number)&&!(value instanceof String))throw new IOException("Invalid reminder state");}
        }
        // A backup containing a referenced original must not silently omit it.
        java.util.regex.Matcher references=java.util.regex.Pattern.compile("schedule-image:([a-f0-9-]+\\.[a-z]+)").matcher(journal.toString());
        while(references.find())if(!files.containsKey("images/"+references.group(1))&&(root==null||!imageName(references.group(1))||!new File(root,"images/"+references.group(1)).isFile()))throw new IOException("Backup is missing an original image");
    }
    static Map<String,byte[]> capture(Context context) throws Exception {
        File root=context.getFilesDir();Map<String,byte[]> files=new TreeMap<>();
        files.put("journal.json",load(new File(root,"journal.json"),"{}"));
        files.put("events.json",load(new File(root,"events.json"),"{\"local\":{},\"remote\":{},\"outbox\":{},\"source\":\"\",\"lastSync\":0}"));
        File[] images=new File(root,"images").listFiles();long total=0;
        if(images!=null)for(File image:images)if(image.isFile()&&imageName(image.getName())) {
            byte[] bytes=Files.readAllBytes(image.toPath());if(bytes.length>MAX_FILE)throw new IOException("Image too large");
            total+=bytes.length;if(total>MAX_TOTAL)throw new IOException("Backup exceeds 256 MiB");files.put("images/"+image.getName(),bytes);
        }
        JSONObject alarms=new JSONObject(context.getSharedPreferences("alarms",Context.MODE_PRIVATE).getAll());
        files.put("alarms.json",alarms.toString().getBytes(StandardCharsets.UTF_8));validate(files);return files;
    }
    static void export(Context context, OutputStream target) throws Exception {
        synchronized(LOCK) {writeZip(capture(context),target);}
    }
    static void writeZip(Map<String,byte[]> files, OutputStream target) throws Exception {
        JSONObject manifest=new JSONObject().put("format","Schedule.Android.Backup").put("version",1), entries=new JSONObject();
        for(Map.Entry<String,byte[]> entry:files.entrySet())entries.put(entry.getKey(),new JSONObject().put("bytes",entry.getValue().length).put("sha256",hash(entry.getValue())));
        manifest.put("files",entries);
        try(ZipOutputStream zip=new ZipOutputStream(target)) {
            zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();
            for(Map.Entry<String,byte[]> entry:files.entrySet()) {zip.putNextEntry(new ZipEntry(entry.getKey()));zip.write(entry.getValue());zip.closeEntry();}
        }
    }
    static Map<String,byte[]> readZip(InputStream source) throws Exception {
        Map<String,byte[]> files=new TreeMap<>();long total=0;
        try(ZipInputStream zip=new ZipInputStream(source)) {
            for(ZipEntry entry;(entry=zip.getNextEntry())!=null;) {
                String name=entry.getName();
                if(!(Arrays.asList("manifest.json","journal.json","events.json","alarms.json").contains(name)||name.startsWith("images/")&&imageName(name.substring(7)))||files.containsKey(name)||entry.isDirectory())throw new IOException("Invalid or duplicate archive entry");
                byte[] bytes=read(zip,MAX_FILE);total+=bytes.length;if(total>MAX_TOTAL)throw new IOException("Backup exceeds 256 MiB");files.put(name,bytes);
            }
        }
        byte[] metadata=files.remove("manifest.json");if(metadata==null)throw new IOException("Backup manifest missing");
        JSONObject manifest=json(metadata), list=manifest.getJSONObject("files");
        if(!"Schedule.Android.Backup".equals(manifest.getString("format"))||manifest.getInt("version")!=1||list.length()!=files.size())throw new IOException("Unsupported backup");
        for(Map.Entry<String,byte[]> entry:files.entrySet()) {
            JSONObject declared=list.getJSONObject(entry.getKey());
            if(declared.getLong("bytes")!=entry.getValue().length||!hash(entry.getValue()).equals(declared.getString("sha256")))throw new IOException("Backup checksum mismatch");
        }
        validate(files);return files;
    }
    static File snapshot(Context context,String reason) throws Exception {
        File history=new File(context.getFilesDir(),"backups");if(!history.isDirectory()&&!history.mkdirs())throw new IOException("Cannot create backup folder");
        File file=new File(history,reason+"-"+System.currentTimeMillis()+"-"+UUID.randomUUID()+".zip");
        try {export(context,new FileOutputStream(file));return file;}catch(Exception e){file.delete();throw e;}
    }
    static void recover(Context context) throws Exception {
        synchronized(LOCK) {
            File metadata=new File(context.getFilesDir(),"pending-metadata.json");
            if(metadata.isFile()) {
                JSONObject saved=json(load(metadata,"{}"));Map<String,byte[]> old=new TreeMap<>();
                for(String name:new String[]{"journal.json","events.json","alarms.json"})old.put(name,android.util.Base64.decode(saved.getString(name),android.util.Base64.NO_WRAP));
                validate(old,context.getFilesDir());install(context,old);
                if(!metadata.delete())throw new IOException("Cannot finish metadata recovery");
            }
            File marker=new File(context.getFilesDir(),"pending-restore.zip");
            if(marker.isFile()) {
                Map<String,byte[]> old=readZip(new FileInputStream(marker));install(context,old);
                if(!marker.delete())throw new IOException("Cannot finish recovery");
            }
        }
    }
    static Map<String,byte[]> captureMetadata(Context context)throws Exception {
        File root=context.getFilesDir();Map<String,byte[]> files=new TreeMap<>();
        files.put("journal.json",load(new File(root,"journal.json"),"{}"));
        files.put("events.json",load(new File(root,"events.json"),"{\"local\":{},\"remote\":{},\"outbox\":{},\"source\":\"\",\"lastSync\":0}"));
        files.put("alarms.json",new JSONObject(context.getSharedPreferences("alarms",Context.MODE_PRIVATE).getAll()).toString().getBytes(StandardCharsets.UTF_8));
        return files;
    }
    // Originals are immutable and already verified on disk. Roll back only the
    // metadata transaction, retaining both previously used and newly received files.
    static void commitMetadata(Context context,Map<String,byte[]> files)throws Exception {
        synchronized(LOCK){
            validate(files,context.getFilesDir());
            JSONObject old=new JSONObject();for(Map.Entry<String,byte[]> e:captureMetadata(context).entrySet())old.put(e.getKey(),android.util.Base64.encodeToString(e.getValue(),android.util.Base64.NO_WRAP));
            byte[] bytes=old.toString().getBytes(StandardCharsets.UTF_8);
            File history=new File(context.getFilesDir(),"backups");
            write(new File(history,"before-sync-"+System.currentTimeMillis()+"-"+UUID.randomUUID()+".metadata.json"),bytes);
            File marker=new File(context.getFilesDir(),"pending-metadata.json");write(marker,bytes);
            try{install(context,files);if(!marker.delete())throw new IOException("Could not finish metadata commit");}
            catch(Exception e){recover(context);throw e;}
        }
    }
    private static void install(Context context,Map<String,byte[]> files) throws Exception {
        // Images are immutable. Keep unreferenced originals as well, including
        // originals created since an older backup; recovery never deletes them.
        for(Map.Entry<String,byte[]> entry:files.entrySet()) if(entry.getKey().startsWith("images/")) {
            File destination=new File(context.getFilesDir(),entry.getKey());
            if(destination.isFile()&&!Arrays.equals(Files.readAllBytes(destination.toPath()),entry.getValue()))throw new IOException("Image identity collision");
            write(destination,entry.getValue());
        }
        write(new File(context.getFilesDir(),"journal.json"),files.get("journal.json"));
        write(new File(context.getFilesDir(),"events.json"),files.get("events.json"));
        if(files.containsKey("alarms.json")) {
            JSONObject alarms=json(files.get("alarms.json"));android.content.SharedPreferences.Editor edit=context.getSharedPreferences("alarms",Context.MODE_PRIVATE).edit().clear();
            for(Iterator<String> it=alarms.keys();it.hasNext();) {String key=it.next();Object v=alarms.get(key);if(v instanceof Boolean)edit.putBoolean(key,(Boolean)v);else if(v instanceof Number)edit.putLong(key,((Number)v).longValue());else if(v instanceof String)edit.putString(key,(String)v);else throw new IOException("Invalid alarm state");}
            if(!edit.commit())throw new IOException("Could not restore reminder state");
        }
    }
    static void commit(Context context,Map<String,byte[]> files) throws Exception {
        synchronized(LOCK) {
            validate(files);
            File root=context.getFilesDir();
            JSONObject previous=json(load(new File(root,"events.json"),"{}")), incoming=json(files.get("events.json"));
            previous.remove("lastSync");incoming.remove("lastSync");
            JSONObject alarms=new JSONObject(context.getSharedPreferences("alarms",Context.MODE_PRIVATE).getAll());
            boolean imagesUnchanged=true;
            for(Map.Entry<String,byte[]> entry:files.entrySet())if(entry.getKey().startsWith("images/")) {
                File image=new File(root,entry.getKey());
                if(!image.isFile()||!Arrays.equals(Files.readAllBytes(image.toPath()),entry.getValue())){imagesUnchanged=false;break;}
            }
            if(Arrays.equals(load(new File(root,"journal.json"),"{}"),files.get("journal.json"))&&previous.toString().equals(incoming.toString())
                    &&imagesUnchanged&&(!files.containsKey("alarms.json")||alarms.toString().equals(json(files.get("alarms.json")).toString()))) {
                // A repeated exchange only advances its timestamp. Avoid a full
                // image archive on every no-op sync or lost-ack retry.
                write(new File(root,"events.json"),files.get("events.json"));return;
            }
            File backup=snapshot(context,"before-change");
            File marker=new File(context.getFilesDir(),"pending-restore.zip");write(marker,Files.readAllBytes(backup.toPath()));
            try {install(context,files);if(!marker.delete())throw new IOException("Could not finish data commit");}
            catch(Exception e){recover(context);throw e;}
        }
    }
}
