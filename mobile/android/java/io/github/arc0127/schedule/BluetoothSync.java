package io.github.arc0127.schedule;

import android.bluetooth.*;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.*;

final class BluetoothSync {
    private final BluetoothAdapter adapter;
    private final EventStore events;
    private final Runnable updated;
    private final Consumer<String> status;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private volatile BluetoothServerSocket server;
    private volatile BluetoothSocket connection;
    private volatile boolean stopped;
    private final String address;
    private final JournalTransfer.Access journal;
    private final android.content.Context context;
    private volatile WifiSync wifi;
    private volatile String phase="accept";

    BluetoothSync(android.content.Context context,BluetoothAdapter adapter, EventStore events, String address, Runnable updated, Consumer<String> status, JournalTransfer.Access journal) {
        this.context=context;
        this.adapter = adapter;
        this.events = events;
        this.address = address;
        this.updated = updated;
        this.status = status;
        this.journal = journal;
    }

    void start() {
        new Thread(this::listen, "Schedule RFCOMM").start();
    }

    void close() {
        stopped = true;
        WifiSync direct=wifi;if(direct!=null)direct.close();
        shutdownSocket(connection);
        BluetoothServerSocket accepting = server;
        if (accepting != null) {
            try { accepting.close(); } catch (IOException ignored) {}
        }
        timer.shutdownNow();
    }

    private static void shutdownSocket(BluetoothSocket socket) {
        if (socket != null) {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private void listen() {
        try (BluetoothServerSocket accepting = adapter.listenUsingRfcommWithServiceRecord("Schedule", Protocol.SERVICE)) {
            server = accepting;
            if (stopped) return;
            status.accept("waiting");
            while (!stopped) {
                try (BluetoothSocket socket = accepting.accept()) {
                    connection = socket;
                    if (stopped) return;
                    BluetoothDevice peer = socket.getRemoteDevice();
                    if (!address.equalsIgnoreCase(peer.getAddress()) || peer.getBondState() != BluetoothDevice.BOND_BONDED) continue;
                    try (TransferWatchdog progress=new TransferWatchdog(android.os.SystemClock::elapsedRealtime,120000)) {
                        progress.start(timer,()->shutdownSocket(socket));
                        try {exchange(socket,progress);}catch(Exception error){
                            if(progress.expired)throw new IOException("传输连续 120 秒没有进展，连接已关闭。请重试。 / No transfer progress for 120 seconds.",error);
                            throw error;
                        }
                    } catch (Exception error) {
                        if (!stopped) {
                            android.util.Log.w("ScheduleSync","Connection failed at "+phase,error);
                            status.accept(failureStatus(phase,error));
                            // A foreground notification can outlive an invalid RFCOMM
                            // service registration. Recreate the acceptor after transport
                            // failure instead of waiting forever on the old server socket.
                            if(transportFailure(error))return;
                        }
                    } finally {
                        connection = null;
                    }
                }
            }
        } catch (Exception error) {
            if (!stopped) status.accept("listener-error:" + error.getMessage());
        } finally {
            server = null;
            timer.shutdownNow();
        }
    }

    static String errorDetails(Throwable error){
        String detail=String.valueOf(error.getMessage());
        for(Throwable cause=error.getCause();cause!=null;cause=cause.getCause()){
            String next=String.valueOf(cause.getMessage());if(!detail.contains(next))detail+=" · "+next;
        }
        return detail;
    }
    static String failureStatus(String phase,Throwable error){return (transportFailure(error)?"listener-error:":"error:")+phase+": "+errorDetails(error);}
    static boolean transportFailure(Throwable error){
        for(Throwable cause=error;cause!=null;cause=cause.getCause()){
            String message=String.valueOf(cause.getMessage()).toLowerCase(java.util.Locale.ROOT);
            if(cause instanceof java.io.EOFException||cause instanceof java.net.SocketException||
                message.contains("broken pipe")||message.contains("connection reset")||message.contains("socket closed")||message.contains("bad file descriptor"))return true;
        }
        return false;
    }

    private void exchange(BluetoothSocket socket,TransferWatchdog progress) throws Exception {
        java.io.InputStream in=progress.input(socket.getInputStream());java.io.OutputStream out=progress.output(socket.getOutputStream());
        phase="connection-check";JSONObject hello = handshake(context,in,out);
        if(hello==null)return;
        android.os.PowerManager.WakeLock awake=context.getSystemService(android.os.PowerManager.class).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"Schedule:sync");
        awake.acquire();
        try {
        String source = Protocol.string(hello, "source");
        if(hello.optInt("journalSync",0)==2) {
            phase="wifi-negotiation";
            if(hello.optInt("wifiSync")==1&&tryWifi(in,out,progress,!hello.optBoolean("automatic")))return;
            phase="journal-transfer";
            JournalExchange.run(in,out,hello,journal,updated,status);
            return;
        }
        JSONArray changes = events.begin(source);
        try {
            status.accept("syncing");
            Protocol.write(out, Protocol.frame("changes").put("items", changes));
            JSONObject result = Protocol.read(in, "snapshot");
            events.finish(source, changes, result);
            updated.run();
            Protocol.write(out, Protocol.frame("ack").put("source", source));
            status.accept("legacy");
        } finally {
            events.end();
        }
        }finally{awake.release();}
    }
    static JSONObject handshake(android.content.Context context,java.io.InputStream in,java.io.OutputStream out)throws Exception {
        JSONObject hello=Protocol.read(in,"hello");
        if(hello.optBoolean("autoProbe")) {
            int hours=hello.optInt("hours",2);
            if(hours==1||hours==2||hours==4||hours==8)SyncService.preferences(context).edit().putInt("hours",hours).apply();
            boolean keep=hello.optBoolean("continueSync");
            Protocol.write(out,SyncService.probe(context).put("continueSync",keep));
            if(!keep||!Protocol.read(in,"auto-next").optBoolean("sync"))return null;
            hello=Protocol.read(in,"hello");
        }
        return hello;
    }
    private boolean tryWifi(java.io.InputStream in,java.io.OutputStream out,TransferWatchdog progress,boolean allowHotspot)throws Exception {
        try {
            JSONObject offer;
            try {wifi=new WifiSync();wifi.start(journal,updated,status);offer=wifi.offer();}
            catch(Exception error){offer=Protocol.frame("wifi-offer").put("available",false).put("reason","无法启动 Wi-Fi 通道");}
            Protocol.write(out,offer);JSONObject choice=Protocol.read(in,"wifi-result");
            if(choice.optBoolean("direct")&&wifi!=null&&allowHotspot) {
                status.accept("wifi-setup");
                try {offer=wifi.directOffer(context);}
                catch(Exception error){offer=Protocol.frame("wifi-offer").put("available",false).put("reason","请允许附近 Wi-Fi 设备；系统当前可能不支持本地热点");}
                Protocol.write(out,offer);choice=Protocol.read(in,"wifi-result");
            }
            if(choice.optBoolean("use")) {
                if(wifi==null)throw new IOException("Wi-Fi channel was not established");
                progress.close();phase="wifi-transfer";status.accept("wifi-transfer");wifi.await();return true;
            }
            status.accept("bluetooth-transfer");return false;
        }catch(IOException error){
            WifiSync current=wifi;String rejected=current==null?null:current.authenticationError();
            if(rejected!=null)throw new IOException("Wi-Fi authentication failed: "+rejected+". Bluetooth negotiation ended: "+error.getMessage(),error);
            throw error;
        }finally{WifiSync direct=wifi;wifi=null;if(direct!=null)direct.close();}
    }
}

