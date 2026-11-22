package io.github.arc0127.schedule;

import android.content.Context;
import android.net.wifi.*;
import android.os.*;
import android.security.keystore.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;
import org.json.*;

/** Credentials travel only over the authenticated Bluetooth channel. */
final class WifiSync implements AutoCloseable {
    private final SSLServerSocket server;
    private volatile SSLSocket active;
    private volatile boolean closed;
    private volatile WifiManager.LocalOnlyHotspotReservation hotspot;
    private final String fingerprint,token;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private Future<?> transfer;
    private volatile String rejectedAuthentication;
    WifiSync()throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);String alias="ScheduleWifiTLS";
        if(!store.containsAlias(alias)) {
            KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048).setDigests(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,KeyProperties.SIGNATURE_PADDING_RSA_PSS)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE,KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
                .setCertificateSubject(new X500Principal("CN=Schedule"))
                .setCertificateNotAfter(new Date(System.currentTimeMillis()+10L*365*86400000)).build());
            generator.generateKeyPair();store.load(null);
        }
        final KeyStore keys=store;
        KeyManager manager=new X509ExtendedKeyManager(){
            public String chooseServerAlias(String type,Principal[] issuers,Socket socket){return type.startsWith("RSA")?alias:null;}
            public String[] getServerAliases(String type,Principal[] issuers){return type.startsWith("RSA")?new String[]{alias}:null;}
            public String chooseClientAlias(String[] types,Principal[] issuers,Socket socket){return null;}
            public String[] getClientAliases(String type,Principal[] issuers){return null;}
            public java.security.cert.X509Certificate[] getCertificateChain(String name){try{Certificate[] chain=keys.getCertificateChain(alias);return Arrays.copyOf(chain,chain.length,java.security.cert.X509Certificate[].class);}catch(Exception e){throw new IllegalStateException(e);}}
            public PrivateKey getPrivateKey(String name){try{return (PrivateKey)keys.getKey(alias,null);}catch(Exception e){throw new IllegalStateException(e);}}
        };
        SSLContext tls=SSLContext.getInstance("TLSv1.2");tls.init(new KeyManager[]{manager},null,new SecureRandom());
        server=(SSLServerSocket)tls.getServerSocketFactory().createServerSocket(0,4);
        server.setEnabledProtocols(new String[]{"TLSv1.2"});server.setSoTimeout(180000);
        fingerprint=DataBackup.hash(store.getCertificate(alias).getEncoded());
        byte[] secret=new byte[24];new SecureRandom().nextBytes(secret);token=android.util.Base64.encodeToString(secret,android.util.Base64.NO_WRAP);
    }
    JSONObject offer()throws Exception {
        JSONArray hosts=new JSONArray();
        for(NetworkInterface nic:Collections.list(NetworkInterface.getNetworkInterfaces()))if(nic.isUp())
            for(InetAddress ip:Collections.list(nic.getInetAddresses()))if(ip instanceof Inet4Address&&ip.isSiteLocalAddress())hosts.put(ip.getHostAddress());
        return Protocol.frame("wifi-offer").put("available",true).put("hosts",hosts).put("port",server.getLocalPort()).put("fingerprint",fingerprint).put("token",token);
    }
    JSONObject directOffer(Context context)throws Exception {
        CompletableFuture<WifiManager.LocalOnlyHotspotReservation> ready=new CompletableFuture<>();
        context.getSystemService(WifiManager.class).startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback(){
            public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation){synchronized(WifiSync.this){if(closed||ready.isDone())reservation.close();else {hotspot=reservation;ready.complete(reservation);}}}
            public void onFailed(int reason){ready.completeExceptionally(new IOException("本地热点不可用 ("+reason+")"));}
            public void onStopped(){ready.completeExceptionally(new IOException("本地热点已停止"));}
        },new Handler(Looper.getMainLooper()));
        WifiManager.LocalOnlyHotspotReservation reservation;
        try{reservation=ready.get(35,TimeUnit.SECONDS);}catch(Exception error){ready.cancel(false);throw error;}
        String ssid,password;
        if(Build.VERSION.SDK_INT>=30){SoftApConfiguration config=reservation.getSoftApConfiguration();ssid=config.getSsid();password=config.getPassphrase();}
        else {WifiConfiguration config=reservation.getWifiConfiguration();ssid=config.SSID;password=config.preSharedKey;}
        if(ssid==null||password==null)throw new IOException("本地热点没有提供连接凭据");
        return offer().put("ssid",ssid).put("password",password).put("direct",true);
    }
    void start(JournalTransfer.Access journal,Runnable updated,Consumer<String> status) {
        transfer=worker.submit(()->{
            try {
                while(!closed) {
                    try(SSLSocket socket=(SSLSocket)server.accept()) {
                        active=socket;socket.setSoTimeout(10000);
                        try {
                            socket.startHandshake();JSONObject auth=Protocol.read(socket.getInputStream(),"wifi-auth");
                            if(!MessageDigest.isEqual(token.getBytes(java.nio.charset.StandardCharsets.UTF_8),auth.getString("token").getBytes(java.nio.charset.StandardCharsets.UTF_8)))continue;
                        }catch(IOException|JSONException rejected){rejectedAuthentication=BluetoothSync.errorDetails(rejected);android.util.Log.w("ScheduleWifi","Connection authentication rejected",rejected);continue;}
                        socket.setSoTimeout(120000);Protocol.write(socket.getOutputStream(),Protocol.frame("wifi-ready"));
                        ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
                        try(TransferWatchdog progress=new TransferWatchdog(SystemClock::elapsedRealtime,120000)) {
                            progress.start(timer,()->{try{socket.close();}catch(IOException ignored){}});
                            InputStream in=progress.input(socket.getInputStream());OutputStream out=progress.output(socket.getOutputStream());
                            JSONObject hello=Protocol.read(in,"hello");JournalExchange.run(in,out,hello,journal,updated,status);
                        }finally{timer.shutdownNow();}
                        return;
                    }finally{active=null;}
                }
            }catch(Exception error){throw new CompletionException(error);}
        });
    }
    void await()throws Exception {transfer.get();}
    String authenticationError(){return rejectedAuthentication;}
    public synchronized void close(){closed=true;if(hotspot!=null){hotspot.close();hotspot=null;}try{server.close();}catch(IOException ignored){}try{if(active!=null)active.close();}catch(IOException ignored){}worker.shutdownNow();}
}
