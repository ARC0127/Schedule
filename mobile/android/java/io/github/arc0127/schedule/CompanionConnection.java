package io.github.arc0127.schedule;

import android.app.Activity;
import android.companion.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import java.io.IOException;

/** System-authorized wake-up for the selected, already bonded computer. */
final class CompanionConnection {
    static final int REQUEST=6301;
    static boolean supported(Context c){return Build.VERSION.SDK_INT>=31&&c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP);}
    static boolean associated(Context c,String address){
        if(!supported(c)||address.isEmpty())return false;
        for(String known:c.getSystemService(CompanionDeviceManager.class).getAssociations())if(known.equalsIgnoreCase(address))return true;
        return false;
    }
    static void observe(Context c,boolean enabled)throws Exception {
        if(!supported(c))return;
        CompanionDeviceManager manager=c.getSystemService(CompanionDeviceManager.class);
        String peer=SyncService.preferences(c).getString("peer","");
        if(Build.VERSION.SDK_INT>=36){
            for(AssociationInfo info:manager.getMyAssociations()){
                if(info.getDeviceMacAddress()==null)continue;
                ObservingDevicePresenceRequest request=new ObservingDevicePresenceRequest.Builder().setAssociationId(info.getId()).build();
                if(enabled&&peer.equalsIgnoreCase(info.getDeviceMacAddress().toString()))manager.startObservingDevicePresence(request);
                else manager.stopObservingDevicePresence(request);
            }
        }else for(String known:manager.getAssociations()){
            if(enabled&&peer.equalsIgnoreCase(known))manager.startObservingDevicePresence(known);
            else manager.stopObservingDevicePresence(known);
        }
    }
    static void request(MainActivity activity,String address)throws Exception {
        if(!supported(activity))throw new IOException("系统不支持伴侣设备唤醒 / Companion wake-up is unavailable");
        if(associated(activity,address)){observe(activity,true);return;}
        CompanionDeviceManager manager=activity.getSystemService(CompanionDeviceManager.class);
        AssociationRequest request=new AssociationRequest.Builder().addDeviceFilter(new BluetoothDeviceFilter.Builder().setAddress(address).build()).setSingleDevice(true).build();
        manager.associate(request,new CompanionDeviceManager.Callback(){
            @Override public void onDeviceFound(IntentSender chooser){
                try{activity.startIntentSenderForResult(chooser,REQUEST,null,0,0,0);}
                catch(Exception error){activity.syncEvent("error",error.getMessage());}
            }
            @Override public void onFailure(CharSequence error){activity.syncEvent("error","后台连接授权未完成 / Background connection approval incomplete: "+error);}
        },new Handler(Looper.getMainLooper()));
    }
    static void appeared(Context c,String address){
        if(address!=null&&address.equalsIgnoreCase(SyncService.preferences(c).getString("peer","")))SyncService.resume(c);
    }
}
