package io.github.arc0127.schedule;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;
import android.util.Base64;
import org.json.*;

final class SyncAssets {
    static final int CHUNK=192*1024, MAXIMUM=64*1024*1024;
    final File folder;
    SyncAssets(File folder)throws IOException{this.folder=folder;if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Cannot create image storage");}
    static boolean valid(String id){return id!=null&&id.matches("[a-f0-9]{64}\\.(png|jpeg|gif|webp|avif|bmp|heic|heif)");}
    File file(String id)throws IOException{if(!valid(id))throw new IOException("Invalid original image identity");return new File(folder,id);}
    static String hash(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[32768];for(int n;(n=in.read(b))!=-1;)digest.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:digest.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    boolean has(String id)throws Exception{File f=file(id);return f.isFile()&&f.length()>0&&f.length()<=MAXIMUM&&id.startsWith(hash(f)+".");}
    JSONArray inventory()throws Exception{JSONArray ids=new JSONArray();File[] files=folder.listFiles();if(files==null)throw new IOException("Cannot list originals");for(File f:files)if(valid(f.getName())&&has(f.getName()))ids.put(f.getName());return ids;}
    static JSONObject reference(String id)throws Exception{if(!valid(id))throw new IOException("Invalid image identity");return new JSONObject().put("ref",true).put("mime","image/"+id.substring(id.indexOf('.')+1));}
    // Convert legacy UUID filenames to content identities without loading images into the WebView.
    JSONObject describe(String name)throws Exception{
        if(!DataBackup.imageName(name))throw new IOException("Invalid image reference");File original=new File(folder,name);
        if(!original.isFile()||original.length()<1||original.length()>MAXIMUM)throw new IOException("Original missing or exceeds 64 MiB");
        String id=hash(original)+name.substring(name.lastIndexOf('.'));File target=file(id);
        if(!has(id)){File tmp=new File(folder,id+".part");Files.copy(original.toPath(),tmp.toPath(),StandardCopyOption.REPLACE_EXISTING);Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}
        return reference(id).put("id",id);
    }
    void validate(JSONObject assets)throws Exception{for(Iterator<String> it=assets.keys();it.hasNext();){String id=it.next();JSONObject a=assets.getJSONObject(id);if(!a.optBoolean("ref")||!a.optString("mime").equals(reference(id).getString("mime"))||!has(id))throw new IOException("Missing or invalid original: "+id);}}
    void send(OutputStream out,InputStream in,JSONObject assets,JSONArray known,Consumer<String> status)throws Exception{
        Set<String> have=new HashSet<>();for(int i=0;i<known.length();i++)have.add(known.getString(i));List<String> ids=new ArrayList<>();
        for(Iterator<String> it=assets.keys();it.hasNext();){String id=it.next();if(!have.contains(id))ids.add(id);}
        Protocol.write(out,Protocol.frame("assets-start").put("count",ids.size()));
        for(int n=0;n<ids.size();n++){String id=ids.get(n);if(!has(id))throw new IOException("Missing original: "+id);File f=file(id);
            Protocol.write(out,Protocol.frame("asset-start").put("id",id).put("length",f.length()));
            try(InputStream image=new FileInputStream(f)){byte[] b=new byte[CHUNK];int index=0,read;long sent=0;while((read=image.read(b))!=-1){Protocol.write(out,Protocol.frame("asset-part").put("index",index++).put("data",Base64.encodeToString(b,0,read,Base64.NO_WRAP)));sent+=read;status.accept("images-send:"+(n+1)+"/"+ids.size()+":"+sent+"/"+f.length());}}
            if(!id.equals(Protocol.read(in,"asset-ack").getString("id")))throw new IOException("Image acknowledgement mismatch");
        }
    }
    void receive(InputStream in,OutputStream out,JSONObject expected,Consumer<String> status)throws Exception{
        int count=Protocol.read(in,"assets-start").getInt("count");if(count<0||count>expected.length())throw new IOException("Invalid image count");Set<String> seen=new HashSet<>();
        for(int n=0;n<count;n++){
            JSONObject header=Protocol.read(in,"asset-start");String id=header.getString("id");File target=file(id),tmp=new File(folder,id+".part");long length=header.getLong("length");
            if(!expected.has(id)||!seen.add(id)||length<1||length>MAXIMUM)throw new IOException("Invalid original image batch");
            try{
                try(FileOutputStream image=new FileOutputStream(tmp)){long received=0;for(int index=0;received<length;index++){
                    JSONObject part=Protocol.read(in,"asset-part");byte[] b=Base64.decode(part.getString("data"),Base64.NO_WRAP);
                    if(part.getInt("index")!=index||b.length<1||b.length>CHUNK||received+b.length>length)throw new IOException("Invalid image chunk");image.write(b);received+=b.length;status.accept("images-receive:"+(n+1)+"/"+count+":"+received+"/"+length);
                }image.getFD().sync();}
                if(!id.startsWith(hash(tmp)+"."))throw new IOException("Original image checksum mismatch");
                Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);
            }finally{tmp.delete();}
            Protocol.write(out,Protocol.frame("asset-ack").put("id",id));
        }validate(expected);
    }
}
