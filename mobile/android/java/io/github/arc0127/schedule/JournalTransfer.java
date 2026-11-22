package io.github.arc0127.schedule;

import java.io.*;
import java.nio.charset.StandardCharsets;
import android.util.Base64;
import org.json.*;

final class JournalTransfer {
    static final int MAXIMUM=100*1024*1024, CHUNK=384*1024;
    interface Access {
        JSONObject prepare(String source) throws Exception;
        default JSONObject prepare(String source,boolean batched)throws Exception{return prepare(source);}
        default SyncAssets assets()throws Exception{return null;}
        void apply(String source,JSONObject sent,JSONObject response) throws Exception;
        void end();
    }
    static boolean accept(String source,JSONObject sent,JSONObject response,Access journal) throws Exception {
        if(!source.equals(response.getString("source")))throw new IOException("Journal source mismatch");
        if(response.optInt("schema")!=2)throw new IOException("Unsupported journal response");
        String status=response.optString("status", "complete");
        if("pending-review".equals(status))return false;
        if(!"complete".equals(status))throw new IOException("Unsupported journal status");
        journal.apply(source,sent,response);return true;
    }
    static JSONObject read(InputStream in) throws Exception {
        JSONObject start=Protocol.read(in,"journal-start");long length=Protocol.number(start,"length");
        if(length<2||length>MAXIMUM)throw new IOException("Journal sync exceeds 100 MiB");
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        for(int index=0;out.size()<length;index++) {
            JSONObject part=Protocol.read(in,"journal-part");
            if(Protocol.number(part,"index")!=index)throw new IOException("Journal chunk order mismatch");
            byte[] bytes=Base64.decode(Protocol.string(part,"data"),Base64.NO_WRAP);
            if(bytes.length<1||bytes.length>CHUNK||out.size()+bytes.length>length)throw new IOException("Invalid journal chunk");
            out.write(bytes);
        }
        byte[] bytes=out.toByteArray();if(!DataBackup.hash(bytes).equals(Protocol.string(start,"sha256")))throw new IOException("Journal checksum mismatch");
        return new JSONObject(StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString());
    }
    static void write(OutputStream out,JSONObject value) throws Exception {
        byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAXIMUM)throw new IOException("Journal sync exceeds 100 MiB");
        Protocol.write(out,Protocol.frame("journal-start").put("length",bytes.length).put("sha256",DataBackup.hash(bytes)));
        for(int offset=0,index=0;offset<bytes.length;offset+=CHUNK,index++)
            Protocol.write(out,Protocol.frame("journal-part").put("index",index).put("data",Base64.encodeToString(bytes,offset,Math.min(CHUNK,bytes.length-offset),Base64.NO_WRAP)));
    }
}
