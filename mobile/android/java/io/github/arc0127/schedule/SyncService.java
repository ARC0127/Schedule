package io.github.arc0127.schedule;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import java.io.*;
import org.json.*;

/** Visible, user-enabled paired-device listener, independent of the editor lifecycle. */
public final class SyncService extends Service {
    static volatile MainActivity activity;
    static volatile SyncService current;
    static volatile String status="idle";
    private static final int NOTICE=6201;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private BluetoothSync listener;
    private SyncEngine engine;
    private String peer="";
    private boolean destroyed;
    private int generation;
    private Runnable retry;
    JournalAccess access;
    static SharedPreferences preferences(Context c){return c.getSharedPreferences("automatic-sync",MODE_PRIVATE);}
    static int hours(Context c){return preferences(c).getInt("hours",2);}
    static JSONObject settings(Context c)throws JSONException {
        SharedPreferences p=preferences(c);
        return new JSONObject().put("enabled",p.getBoolean("enabled",true)).put("peer",p.getString("peer",""))
            .put("hours",hours(c)).put("lastSync",p.getLong("lastSync",0)).put("lastError",p.getString("lastError",""));
    }
    static void configure(Context c,String peer,boolean enabled,int hours)throws IOException {
        if(!BluetoothAdapter.checkBluetoothAddress(peer)||!(hours==1||hours==2||hours==4||hours==8))throw new IOException("Invalid paired device or interval");
        if(!preferences(c).edit().putString("peer",peer).putBoolean("enabled",enabled).putInt("hours",hours).commit())throw new IOException("Cannot save automatic sync settings");
    }
    static void changed(Context c){preferences(c).edit().putLong("changed",System.currentTimeMillis()).apply();}
    static void disable(Context c){preferences(c).edit().putBoolean("enabled",false).apply();try{CompanionConnection.observe(c,false);}catch(Exception error){android.util.Log.w("ScheduleSync","Cannot stop presence observation",error);}c.stopService(new Intent(c,SyncService.class));status="idle";notifyUi("permissions",new JSONObject());}
    static void resume(Context c) {
        SharedPreferences p=preferences(c);if(!p.getBoolean("enabled",true)||p.getString("peer","").isEmpty())return;
        if(Build.VERSION.SDK_INT>=31&&c.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)return;
        try {CompanionConnection.observe(c,true);}catch(Exception error){android.util.Log.w("ScheduleSync","Cannot observe selected computer",error);}
        try {c.startForegroundService(new Intent(c,SyncService.class));}
        catch(RuntimeException error){status="error:后台同步未启动，请打开 Schedule / Open Schedule to resume background sync: "+error.getMessage();notifyUi("permissions",new JSONObject());}
    }
    static void notifyUi(String event,Object value){MainActivity current=activity;if(current!=null)current.syncEvent(event,value);}
    private final BroadcastReceiver radios=new BroadcastReceiver(){public void onReceive(Context c,Intent intent){restart();}};
    @Override public void onCreate(){
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("schedule-sync","Schedule 同步 / Sync",NotificationManager.IMPORTANCE_LOW));
        startForeground(NOTICE,notification("自动同步 · 每 "+hours(this)+" 小时 / Automatic sync"));
        IntentFilter filter=new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(radios,filter,Context.RECEIVER_EXPORTED);else registerReceiver(radios,filter);
        engine=new SyncEngine(this);
        try{access=new JournalAccess(this,engine::query,()->{MainActivity active=activity;if(active!=null)active.syncGuard();},()->notifyUi("journal",new JSONObject()));}
        catch(Exception error){setStatus("error:"+error.getMessage());stopSelf();return;}
        current=this;
    }
    private Notification notification(String text){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,0,new Intent(this,SyncService.class).setAction("pause"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"schedule-sync").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Schedule")
            .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).addAction(new Notification.Action.Builder(null,"暂停 / Pause",stop).build()).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"pause".equals(intent.getAction())){disable(this);return START_NOT_STICKY;}
        if(!preferences(this).getBoolean("enabled",true)){stopSelf();return START_NOT_STICKY;}
        restart();return START_STICKY;
    }
    private void restart(){
        if(destroyed)return;
        try {
            String selected=preferences(this).getString("peer","");
            BluetoothManager manager=getSystemService(BluetoothManager.class);BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
            if(adapter==null||!adapter.isEnabled()){closeListener();setStatus("offline");return;}
            if(selected.isEmpty()||adapter.getRemoteDevice(selected).getBondState()!=BluetoothDevice.BOND_BONDED)throw new IOException("请重新选择已配对电脑 / Select a paired computer");
            if(listener!=null&&peer.equals(selected))return;
            closeListener();peer=selected;final int sessionId=generation;
            BluetoothSync session=new BluetoothSync(this,adapter,EventStore.get(this),peer,()->{
                try{ReminderReceiver.reconcile(this);}catch(Exception error){setStatus("error:"+error.getMessage());}
                notifyUi("events",new JSONObject());
            },value->handler.post(()->{if(!destroyed&&sessionId==generation)listenerStatus(value);}),access);
            listener=session;session.start();
        }catch(Exception error){setStatus("error:"+error.getMessage());}
    }
    private void closeListener(){generation++;if(retry!=null){handler.removeCallbacks(retry);retry=null;}if(listener!=null)listener.close();listener=null;}
    private void listenerStatus(String value){
        if(value.startsWith("listener-error:")){
            String detail=value.substring(15);closeListener();setStatus("retrying:"+detail);
            retry=()->{retry=null;if(!destroyed&&preferences(this).getBoolean("enabled",true))restart();};
            handler.postDelayed(retry,30000);return;
        }
        setStatus(value);
    }
    private long lastImageStatus;
    private void setStatus(String value){
        if(value.startsWith("error:")||value.startsWith("retrying:"))preferences(this).edit().putString("lastError",value.substring(value.indexOf(':')+1)).apply();
        if(value.startsWith("images-")){long now=SystemClock.elapsedRealtime();if(now-lastImageStatus<250)return;lastImageStatus=now;}
        status=value;
        if("synced".equals(value))preferences(this).edit().putLong("lastSync",System.currentTimeMillis()).apply();
        notifyUi("status",value);
        handler.post(()->{if(!destroyed)getSystemService(NotificationManager.class).notify(NOTICE,notification(
            value.equals("review")?"请在电脑确认冲突 / Review conflicts on Windows":value.startsWith("retrying:")?"连接中断，等待自动重连 / Waiting to reconnect":value.startsWith("error:")?value.substring(6):"自动同步 · 每 "+hours(this)+" 小时 / Automatic sync"));});
    }
    static JSONObject probe(Context c)throws Exception {
        File dir=c.getFilesDir();SharedPreferences p=preferences(c);
        return Protocol.frame("auto-status").put("enabled",p.getBoolean("enabled",true)).put("hours",hours(c))
            .put("revision",new File(dir,"journal.json").lastModified()+":"+new File(dir,"events.json").lastModified())
            .put("changed",Math.max(p.getLong("changed",0),Math.max(new File(dir,"journal.json").lastModified(),new File(dir,"events.json").lastModified())));
    }
    @Override public void onDestroy(){destroyed=true;current=null;closeListener();handler.removeCallbacksAndMessages(null);unregisterReceiver(radios);if(engine!=null)engine.close();status="idle";super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}

    public static final class Boot extends BroadcastReceiver {
        @Override public void onReceive(Context context,Intent intent){resume(context);}
    }
}
