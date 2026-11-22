package io.github.arc0127.schedule;

import android.companion.*;

/** Android binds this service when an authorized computer reconnects. */
public final class CompanionPresenceService extends CompanionDeviceService {
    @Override public void onDeviceAppeared(String address){CompanionConnection.appeared(this,address);}
    @Override public void onDeviceAppeared(AssociationInfo info){if(info.getDeviceMacAddress()!=null)CompanionConnection.appeared(this,info.getDeviceMacAddress().toString());}
    @Override public void onDevicePresenceEvent(DevicePresenceEvent event){
        if(event.getEvent()!=DevicePresenceEvent.EVENT_BT_CONNECTED&&event.getEvent()!=DevicePresenceEvent.EVENT_BLE_APPEARED)return;
        for(AssociationInfo info:getSystemService(CompanionDeviceManager.class).getMyAssociations())if(info.getId()==event.getAssociationId())onDeviceAppeared(info);
    }
}
