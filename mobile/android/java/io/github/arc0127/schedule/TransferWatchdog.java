package io.github.arc0127.schedule;

import java.io.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Only idle time expires; successful reads and writes keep a transfer alive. */
final class TransferWatchdog implements AutoCloseable {
    private final LongSupplier clock;
    private final long limit;
    private volatile long last;
    volatile boolean expired;
    private ScheduledFuture<?> task;
    TransferWatchdog(LongSupplier clock,long limit){this.clock=clock;this.limit=limit;touch();}
    void touch(){last=clock.getAsLong();}
    boolean idle(){return clock.getAsLong()-last>=limit;}
    void start(ScheduledExecutorService timer,Runnable abort){task=timer.scheduleAtFixedRate(()->{if(idle()){expired=true;abort.run();}},1,1,TimeUnit.SECONDS);}
    InputStream input(InputStream in){return new FilterInputStream(in){
        public int read()throws IOException{int n=in.read();if(n>=0)touch();return n;}
        public int read(byte[] b,int o,int n)throws IOException{int r=in.read(b,o,n);if(r>0)touch();return r;}
    };}
    OutputStream output(OutputStream out){return new FilterOutputStream(out){
        public void write(int b)throws IOException{out.write(b);touch();}
        public void write(byte[] b,int o,int n)throws IOException{for(int at=0;at<n;){int size=Math.min(16384,n-at);out.write(b,o+at,size);at+=size;touch();}}
    };}
    public void close(){if(task!=null)task.cancel(false);}
}
