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
                        if (!stopped) status.accept("error:" + error.getMessage());
                    } finally {
                        connection = null;
                    }
                }
            }
        } catch (Exception error) {
            if (!stopped) status.accept("error:" + error.getMessage());
        } finally {
            server = null;
            timer.shutdownNow();
        }
    }

    private void exchange(BluetoothSocket socket,TransferWatchdog progress) throws Exception {
        java.io.InputStream in=progress.input(socket.getInputStream());java.io.OutputStream out=progress.output(socket.getOutputStream());
        JSONObject hello = Protocol.read(in, "hello");
        String source = Protocol.string(hello, "source");
        if(hello.optInt("journalSync",0)==2) {
            if(hello.optInt("wifiSync")==1&&tryWifi(in,out,progress))return;
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
    }
    private boolean tryWifi(java.io.InputStream in,java.io.OutputStream out,TransferWatchdog progress)throws Exception {
        try {
            JSONObject offer;
            try {wifi=new WifiSync();wifi.start(journal,updated,status);offer=wifi.offer();}
            catch(Exception error){offer=Protocol.frame("wifi-offer").put("available",false).put("reason","无法启动 Wi-Fi 通道");}
            Protocol.write(out,offer);JSONObject choice=Protocol.read(in,"wifi-result");
            if(choice.optBoolean("direct")&&wifi!=null) {
                status.accept("wifi-setup");
                try {offer=wifi.directOffer(context);}
                catch(Exception error){offer=Protocol.frame("wifi-offer").put("available",false).put("reason","请允许附近 Wi-Fi 设备；系统当前可能不支持本地热点");}
                Protocol.write(out,offer);choice=Protocol.read(in,"wifi-result");
            }
            if(choice.optBoolean("use")) {
                if(wifi==null)throw new IOException("Wi-Fi channel was not established");
                progress.close();status.accept("wifi-transfer");wifi.await();return true;
            }
            status.accept("bluetooth-transfer");return false;
        }finally{WifiSync direct=wifi;wifi=null;if(direct!=null)direct.close();}
    }
}

