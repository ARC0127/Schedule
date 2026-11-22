package io.github.arc0127.schedule;

import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.io.*;
import java.nio.file.Files;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class AndroidTests extends Instrumentation {
    private int count;
    private boolean bootSeed;
    private String mode="";

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        bootSeed = arguments != null && "1".equals(arguments.getString("bootSeed"));
        mode=arguments==null?"":arguments.getString("mode","");
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if("upgrade-seed".equals(mode)||"fixture-seed".equals(mode))upgradeSeed();
            else if("upgrade-verify".equals(mode))upgradeVerify();
            else if("full".equals(mode))fullSync();
            else if("batch-seed".equals(mode))batchSeed();
            else if("batch-recovery".equals(mode))batchRecovery();
            else if("wifi".equals(mode)||"wifi-repeat".equals(mode))wifiSync();
            else if("showcase".equals(mode))showcase();
            else if("gestures".equals(mode))verifyGestures();
            else if (bootSeed) {
                long at = System.currentTimeMillis() + 120_000;
                JSONObject event = makeEvent(at, "SYNTHETIC reboot reminder", "android-boot-test");
                EventStore.get(getTargetContext()).edit("local", event.getString("key"), event);
                ReminderReceiver.reconcile(getTargetContext());
                result.putString("seed", event.getString("key") + " at " + at);
            } else verify();
            result.putString("stream", "Schedule assertions passed: " + count + "\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void check(boolean condition, String explanation) {
        if (!condition) throw new AssertionError(explanation);
        count++;
        Bundle result = new Bundle();
        result.putString("stream", "PASS " + explanation + "\n");
        sendStatus(1, result);
    }

    private static final String ORIGINAL="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmVQAAAAASUVORK5CYII=";
    private static final String IMAGE="11111111-1111-4111-8111-111111111111.png";
    private void upgradeSeed() throws Exception {
        Context c=getTargetContext();File images=new File(c.getFilesDir(),"images");images.mkdirs();
        Files.write(new File(images,IMAGE).toPath(),android.util.Base64.decode(ORIGINAL,0));
        JSONObject journal=new JSONObject().put("days",new JSONObject().put("2034-03-12","手机原有笔记"))
            .put("projects",new JSONArray().put(new JSONObject().put("id","phone-project").put("name","手机原有项目")))
            .put("ideas",new JSONArray().put(new JSONObject().put("id","phone-idea").put("date","2034-03-12").put("text","手机原有想法 ![original](schedule-image:"+IMAGE+")")
                .put("state","todo").put("important",true).put("due","").put("projects",new JSONArray().put("phone-project"))))
            .put("docs",new JSONObject());
        Files.write(new File(c.getFilesDir(),"journal.json").toPath(),journal.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        JSONObject event=makeEvent(System.currentTimeMillis()+3600000,"手机原有日程","android-upgrade");
        EventStore.get(c).unlink();EventStore.get(c).edit("local",event.getString("key"),event);
        File witness=c.getExternalFilesDir(null);witness.mkdirs();
        for(String name:new String[]{"journal.json","events.json"})Files.write(new File(witness,"upgrade-"+name).toPath(),Files.readAllBytes(new File(c.getFilesDir(),name).toPath()));
        check(true,"existing notes, project, image and local event seeded");
    }
    private void upgradeVerify() throws Exception {
        Context c=getTargetContext();
        for(String name:new String[]{"journal.json","events.json"})check(Arrays.equals(Files.readAllBytes(new File(c.getExternalFilesDir(null),"upgrade-"+name).toPath()),Files.readAllBytes(new File(c.getFilesDir(),name).toPath())),"in-place APK upgrade preserved "+name+" bytes");
        check(Arrays.equals(Files.readAllBytes(new File(c.getFilesDir(),"images/"+IMAGE).toPath()),android.util.Base64.decode(ORIGINAL,0)),"upgrade preserved original image bytes");
    }
    private void fullSync() throws Exception {
        Context context=getTargetContext();
        Map<String,byte[]> original=DataBackup.capture(context);ByteArrayOutputStream archive=new ByteArrayOutputStream();DataBackup.export(context,archive);
        Map<String,byte[]> unpacked=DataBackup.readZip(new ByteArrayInputStream(archive.toByteArray()));
        for(String name:original.keySet())check(Arrays.equals(original.get(name),unpacked.get(name)),"complete backup bytes: "+name);
        Map<String,byte[]> mutated=new TreeMap<>(original);mutated.put("journal.json","{\"days\":{},\"ideas\":[],\"projects\":[]}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        DataBackup.commit(context,mutated);DataBackup.commit(context,unpacked);EventStore.get(context).reload();
        check(Arrays.equals(Files.readAllBytes(new File(context.getFilesDir(),"journal.json").toPath()),original.get("journal.json")),"complete restore retains journal and project bindings");
        byte[] damaged=Arrays.copyOf(archive.toByteArray(),archive.size()/2);
        try{DataBackup.readZip(new ByteArrayInputStream(damaged));throw new AssertionError("Truncated archive accepted");}catch(IOException|JSONException expected){check(true,"truncated backup rejected before mutation");}
        DataBackup.write(new File(context.getFilesDir(),"pending-restore.zip"),archive.toByteArray());
        DataBackup.write(new File(context.getFilesDir(),"journal.json"),"{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));DataBackup.recover(context);
        check(Arrays.equals(Files.readAllBytes(new File(context.getFilesDir(),"journal.json").toPath()),original.get("journal.json")),"interrupted multi-file commit rolls back on recovery");
        EventStore.get(context).reload();
        Activity activity=startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView web=(WebView)((ViewGroup)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0)).getChildAt(0);
        try {
            for(int i=0;i<60&&!"true".equals(js(web,"typeof window.syncRequest==='function'"));i++)SystemClock.sleep(200);
            check("true".equals(js(web,"typeof window.syncRequest==='function'")),"packaged Android full-sync bridge loaded");
            File incoming=new File(context.getExternalFilesDir(null),"full-sync-desktop.json");
            JSONObject desktop=new JSONObject(new String(Files.readAllBytes(incoming.toPath()),java.nio.charset.StandardCharsets.UTF_8));
            String source=desktop.getString("source");JournalTransfer.Access access=((MainActivity)activity).fullJournalAccess();
            JSONObject sent=access.prepare(source);
            Map<String,byte[]> beforePending=DataBackup.capture(context);
            check(!JournalTransfer.accept(source,sent,new JSONObject().put("schema",2).put("source",source).put("status","pending-review"),access),"pending desktop review skips Android apply");
            access.end();
            Map<String,byte[]> afterPending=DataBackup.capture(context);
            check(beforePending.keySet().equals(afterPending.keySet()),"pending review adds or removes no user data files");
            for(String name:beforePending.keySet())check(Arrays.equals(beforePending.get(name),afterPending.get(name)),"pending review preserves bytes: "+name);
            sent=access.prepare(source);
            check(sent.getJSONObject("entities").has("idea/phone-idea"),"pending review releases editing lock for retry");
            check(sent.getJSONObject("entities").has("idea/phone-idea"),"native prepare includes pre-upgrade phone idea");
            check(sent.getJSONObject("assets").length()>0,"native prepare includes original images");
            check(sent.getJSONObject("entities").toString().contains("手机原有日程"),"native prepare includes formerly phone-only events");
            Files.write(new File(context.getExternalFilesDir(null),"full-sync-phone.json").toPath(),sent.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ByteArrayOutputStream transfer=new ByteArrayOutputStream();JournalTransfer.write(transfer,sent);
            check(JournalTransfer.read(new ByteArrayInputStream(transfer.toByteArray())).getJSONObject("entities").has("idea/phone-idea"),"Android chunk transport preserves journal");
            // Merge a real Windows-generated snapshot with this actual native export.
            String expression="(()=>{const sent="+sent+",desktop="+desktop+";const merged=ScheduleSyncModel.merge(sent.base,desktop.entities,sent.entities);return JSON.stringify({...merged,schema:2,source:sent.source,assets:{...desktop.assets,...sent.assets}});})()";
            JSONObject response=new JSONObject((String)new JSONTokener(js(web,expression)).nextValue());
            JSONObject localEvent=null;JSONArray visibleEvents=EventStore.get(context).visible();
            for(int i=0;i<visibleEvents.length();i++)if("手机原有日程".equals(visibleEvents.getJSONObject(i).getString("title")))localEvent=visibleEvents.getJSONObject(i);
            String alarmIdentity=localEvent.getString("key"),fired="fired:"+localEvent.getLong("at")+"/"+localEvent.getInt("minutes");
            context.getSharedPreferences("alarms",Context.MODE_PRIVATE).edit().putString("local:"+alarmIdentity,fired).commit();
            access.apply(source,sent,response);access.end();
            check(fired.equals(context.getSharedPreferences("alarms",Context.MODE_PRIVATE).getString("remote:"+alarmIdentity,"")),"migrating phone-only events preserves fired-reminder identity");
            check(new JSONObject(new String(Files.readAllBytes(new File(context.getFilesDir(),"journal.json").toPath()),java.nio.charset.StandardCharsets.UTF_8)).getJSONArray("ideas").length()>=3,"native apply persists both Windows and Android ideas");
            check(EventStore.get(context).visible().toString().contains("手机原有日程"),"native apply retains phone event while adding Windows events");
            String originalId=sent.getJSONObject("assets").keys().next();
            check(Arrays.equals(Files.readAllBytes(new File(context.getFilesDir(),"images/"+originalId).toPath()),android.util.Base64.decode(ORIGINAL,0)),"received content-addressed image preserves original bytes");
            js(web,"showImage("+JSONObject.quote(originalId)+")");
            boolean visible=false;for(int i=0;i<30;i++){if("true".equals(js(web,"preview.open && preview.firstChild.naturalWidth===1"))){visible=true;break;}SystemClock.sleep(100);}
            check(visible,"received image opens in the real Android preview");js(web,"preview.close()");
            JSONObject again=access.prepare(source);access.apply(source,again,response);access.end();
            check(again.getJSONObject("entities").length()==response.getJSONObject("entities").length(),"native replay does not duplicate records");
            check("true".equals(js(web,"selectTab('projects');project='phone-project';render();screen.textContent.includes('手机原有想法') && screen.textContent.includes('手机原有项目')")),"synced project opens its linked cross-day idea in Android UI");
            js(web,"save(next=>{next.projects.push({id:'second-phone-project',name:'手机第二项目'});next.ideas.find(i=>i.id==='phone-idea').projects.push('second-phone-project')})");
            JSONObject projectSent=access.prepare(source);
            check(projectSent.getJSONObject("entities").has("project/second-phone-project")&&projectSent.getJSONObject("entities").getJSONObject("idea/phone-idea").getJSONArray("projects").length()==2,"phone export includes new project and multiple idea bindings");
            JSONObject renamed=new JSONObject(response.getJSONObject("entities").toString());
            renamed.getJSONObject("project/phone-project").put("name","电脑重命名项目");
            String projectExpression="(()=>{const s="+projectSent+",r="+renamed+";return JSON.stringify({...ScheduleSyncModel.merge(s.base,r,s.entities),schema:2,source:s.source,assets:"+response.getJSONObject("assets")+"});})()";
            response=new JSONObject((String)new JSONTokener(js(web,projectExpression)).nextValue());
            access.apply(source,projectSent,response);access.end();
            check("true".equals(js(web,"selectTab('projects');project='phone-project';render();screen.textContent.includes('电脑重命名项目') && projectItems('phone-project').some(i=>i.id==='phone-idea') && projectItems('second-phone-project').some(i=>i.id==='phone-idea')")),"desktop project rename and phone multi-binding coexist in project UI");
            JSONObject persisted=new JSONObject(new String(Files.readAllBytes(new File(context.getFilesDir(),"journal.json").toPath()),java.nio.charset.StandardCharsets.UTF_8));
            check(persisted.toString().contains("电脑重命名项目")&&persisted.toString().contains("second-phone-project"),"project names and bindings persisted to Android storage");
            js(web,"save(next=>{next.ideas.find(i=>i.id==='phone-idea').text='手机并发版本'});");
            JSONObject conflictSent=access.prepare(source),remoteEntities=new JSONObject(response.getJSONObject("entities").toString());
            remoteEntities.getJSONObject("idea/phone-idea").put("text","电脑并发版本");
            String conflictExpression="(()=>{const s="+conflictSent+",r="+remoteEntities+";return JSON.stringify({...ScheduleSyncModel.merge(s.base,r,s.entities),schema:2,source:s.source,assets:"+response.getJSONObject("assets")+"});})()";
            JSONObject conflictResponse=new JSONObject((String)new JSONTokener(js(web,conflictExpression)).nextValue());
            access.apply(source,conflictSent,conflictResponse);access.end();
            check("true".equals(js(web,"state._sync.conflicts['idea/phone-idea'].desktop.text==='电脑并发版本' && state.ideas.find(i=>i.id==='phone-idea').text==='手机并发版本'")),"native conflict commit retains both text versions");
            js(web,"selectTab('sync');resolveJournalConflict('idea/phone-idea',false)");
            boolean resolved=false;for(int i=0;i<50;i++){if("true".equals(js(web,"!state._sync.conflicts['idea/phone-idea']"))){resolved=true;break;}SystemClock.sleep(100);}
            check(resolved,"real conflict UI handler persists explicit phone choice");
            JSONObject resolvedSent=access.prepare(source);access.end();
            check("电脑并发版本".equals(resolvedSent.getJSONObject("base").getJSONObject("idea/phone-idea").getString("text"))&&"手机并发版本".equals(resolvedSent.getJSONObject("entities").getJSONObject("idea/phone-idea").getString("text")),"chosen phone version is queued against the reviewed desktop baseline");
            check(new File(context.getFilesDir(),"backups").list().length>=3,"upgrade and mutations create full recovery backups");
        } finally {runOnMainSync(activity::finish);}
    }

    private void batchRecovery() throws Exception {
        Context c=getTargetContext();SyncAssets assets=new SyncAssets(new File(c.getFilesDir(),"batch-test-"+java.util.UUID.randomUUID()));
        byte[] first=new byte[32768],second=new byte[32768];java.util.Arrays.fill(first,(byte)7);java.util.Arrays.fill(second,(byte)9);
        String a=DataBackup.hash(first)+".png",b=DataBackup.hash(second)+".png";
        JSONObject expected=new JSONObject().put(a,SyncAssets.reference(a)).put(b,SyncAssets.reference(b));
        ByteArrayOutputStream wire=new ByteArrayOutputStream(),acks=new ByteArrayOutputStream();
        Protocol.write(wire,Protocol.frame("assets-start").put("count",2));
        Protocol.write(wire,Protocol.frame("asset-start").put("id",a).put("length",first.length));
        Protocol.write(wire,Protocol.frame("asset-part").put("index",0).put("data",android.util.Base64.encodeToString(first,2)));
        Protocol.write(wire,Protocol.frame("asset-start").put("id",b).put("length",second.length));
        boolean failed=false;try{assets.receive(new java.io.ByteArrayInputStream(wire.toByteArray()),acks,expected,status->{});}catch(java.io.EOFException e){failed=true;}
        check(failed&&assets.has(a)&&!assets.has(b),"Android interruption retains only completed verified originals");
        check(!new File(assets.folder,b+".part").exists(),"Android incomplete original is not left published");
        check(Protocol.read(new java.io.ByteArrayInputStream(acks.toByteArray()),"asset-ack").getString("id").equals(a),"Android acknowledges the completed original only");
        wire.reset();Protocol.write(wire,Protocol.frame("assets-start").put("count",1));
        Protocol.write(wire,Protocol.frame("asset-start").put("id",b).put("length",second.length));
        Protocol.write(wire,Protocol.frame("asset-part").put("index",0).put("data",android.util.Base64.encodeToString(second,2)));
        assets.receive(new java.io.ByteArrayInputStream(wire.toByteArray()),new ByteArrayOutputStream(),expected,status->{});
        check(assets.has(a)&&assets.has(b),"Android retry accepts only missing original and preserves both bytes");
        wire.reset();Protocol.write(wire,Protocol.frame("assets-start").put("count",1));
        Protocol.write(wire,Protocol.frame("asset-start").put("id",b).put("length",first.length));
        Protocol.write(wire,Protocol.frame("asset-part").put("index",0).put("data",android.util.Base64.encodeToString(first,2)));
        failed=false;try{assets.receive(new java.io.ByteArrayInputStream(wire.toByteArray()),new ByteArrayOutputStream(),expected,status->{});}catch(java.io.IOException e){failed=true;}
        check(failed&&assets.has(b),"Android checksum rejection does not replace a valid original");
        Map<String,byte[]> old=DataBackup.captureMetadata(c);JSONObject marker=new JSONObject();for(Map.Entry<String,byte[]> item:old.entrySet())marker.put(item.getKey(),android.util.Base64.encodeToString(item.getValue(),2));
        DataBackup.write(new File(c.getFilesDir(),"pending-metadata.json"),marker.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        DataBackup.write(new File(c.getFilesDir(),"journal.json"),"{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));DataBackup.recover(c);
        check(java.util.Arrays.equals(old.get("journal.json"),DataBackup.load(new File(c.getFilesDir(),"journal.json"),"")),"interrupted metadata commit restores exact journal bytes");
        check(java.util.Arrays.equals(old.get("events.json"),DataBackup.load(new File(c.getFilesDir(),"events.json"),"")),"interrupted metadata commit restores exact events bytes");
        check(!new File(c.getFilesDir(),"pending-metadata.json").exists(),"successful metadata recovery removes marker");
    }

    private void batchSeed() throws Exception {
        Context c=getTargetContext();File staged=new File(c.getExternalFilesDir(null),"batch-images");
        JSONObject manifest=new JSONObject(new String(Files.readAllBytes(new File(c.getExternalFilesDir(null),"batch-manifest.json").toPath()),java.nio.charset.StandardCharsets.UTF_8));
        JSONArray ids=manifest.getJSONArray("ids");StringBuilder text=new StringBuilder("phone-batch ");long size=0;
        for(int i=0;i<ids.length();i++){String id=ids.getString(i);File original=new File(staged,id),target=new File(c.getFilesDir(),"images/"+id);Files.copy(original.toPath(),target.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);size+=target.length();text.append("\n![phone](schedule-image:").append(id).append(")");}
        Map<String,byte[]> files=DataBackup.captureMetadata(c);JSONObject journal=DataBackup.json(files.get("journal.json"));
        journal.getJSONArray("ideas").put(new JSONObject().put("id","phone-batch").put("date","2034-03-12").put("text",text.toString()).put("projects",new JSONArray()).put("state","note").put("important",false).put("due",""));
        files.put("journal.json",journal.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));DataBackup.commitMetadata(c,files);
        check(size>100L*1024*1024,"phone original fixture exceeds 100 MiB");
    }

    private void wifiSync() throws Exception {
        long[] clock={0};TransferWatchdog watchdog=new TransferWatchdog(()->clock[0],120000);
        for(int i=0;i<20;i++){clock[0]+=30000;watchdog.touch();check(!watchdog.idle(),"active transfer survives virtual time beyond four minutes");}
        clock[0]+=120001;check(watchdog.idle(),"idle transfer expires independently of total duration");watchdog.close();
        Context context=getTargetContext();
        Activity activity=startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView web=(WebView)((ViewGroup)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0)).getChildAt(0);
        try {
            for(int i=0;i<60&&!"true".equals(js(web,"typeof window.syncRequest==='function'"));i++)SystemClock.sleep(200);
            JournalTransfer.Access access=((MainActivity)activity).fullJournalAccess();
            try(WifiSync wifi=new WifiSync()) {
                wifi.start(access,()->{},s->{});
                File offer=new File(context.getExternalFilesDir(null),"wifi-offer.json");
                Files.write(offer.toPath(),wifi.offer().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                check(true,"TLS listener ready; offer stored in isolated emulator fixture");
                wifi.await();
            }
            JSONObject saved=new JSONObject(new String(Files.readAllBytes(new File(context.getFilesDir(),"journal.json").toPath()),java.nio.charset.StandardCharsets.UTF_8));
            check(saved.toString().contains("wifi-desktop-idea"),"real TLS transfer commits desktop idea to Android");
            check(saved.toString().contains("phone-idea"),"real TLS transfer retains phone idea");
            check(saved.toString().contains("wifi-large"),"large original image reference is retained");
            JSONObject current=saved.getJSONObject("_sync").getJSONObject("current");
            String text=current.getJSONObject("idea/wifi-desktop-idea").getString("text");
            java.util.regex.Matcher match=java.util.regex.Pattern.compile("schedule-image:([a-f0-9]{64}\\.png)").matcher(text);check(match.find(),"image identity returned through TLS");
            byte[] bytes=Files.readAllBytes(new File(context.getFilesDir(),"images/"+match.group(1)).toPath());
            check(bytes.length>2*1024*1024&&match.group(1).startsWith(DataBackup.hash(bytes)),"multi-megabyte original image arrives byte-exact");
            if(saved.toString().contains("phone-batch")) {
                SyncAssets originals=new SyncAssets(new File(context.getFilesDir(),"images"));long total=0;int count=0;
                java.util.regex.Matcher refs=java.util.regex.Pattern.compile("schedule-image:([a-f0-9]{64}\\.png)").matcher(current.toString());java.util.Set<String> seen=new java.util.HashSet<>();
                while(refs.find())if(seen.add(refs.group(1))){check(originals.has(refs.group(1)),"batch original retained byte-exact");total+=originals.file(refs.group(1)).length();count++;}
                check(total>256L*1024*1024,"metadata commit succeeds with over 256 MiB of originals");
                check(new File(context.getFilesDir(),"journal.json").length()<200000,"journal remains metadata only");
                check(!new File(context.getFilesDir(),"pending-metadata.json").exists(),"metadata transaction completed without recovery marker");
            }

        }finally{runOnMainSync(activity::finish);}
    }

    private JSONObject makeEvent(long at, String title, String id) throws Exception {
        ZonedDateTime date = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault());
        return new JSONObject().put("key", date.toLocalDate() + "/" + id).put("title", title)
                .put("time", date.format(DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)))
                .put("at", at).put("minutes", 0).put("done", false).put("important", true).put("locked", false);
    }

    private void verify() throws Exception {
        Context context = getTargetContext();
        EventStore store = EventStore.get(context);
        String computer = String.join("", Collections.nCopies(64, "a"));
        JSONObject remote = makeEvent(System.currentTimeMillis() + 3_600_000, "合成测试 Ω", "desktop-test");
        String remoteKey = remote.getString("key");
        JSONObject snapshot = Protocol.frame("snapshot").put("source", computer)
                .put("events", new JSONArray().put(remote)).put("results", new JSONArray());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Protocol.write(bytes, snapshot);
        byte[] framed = bytes.toByteArray();
        JSONObject decoded = Protocol.read(new ByteArrayInputStream(framed), "snapshot");
        store.finish(computer, store.begin(computer), decoded);
        store.end();
        check(store.visible().getJSONObject(0).getString("title").equals("合成测试 Ω"), "UTF-8 frame and durable replica");
        try {
            Protocol.read(new ByteArrayInputStream(Arrays.copyOf(framed, framed.length - 5)), "snapshot");
            throw new AssertionError("Truncated frame accepted");
        } catch (EOFException expected) { check(true, "truncated frame rejected"); }
        try {
            Protocol.snapshot(new JSONArray().put(remote).put(remote));
            throw new AssertionError("Duplicate snapshot keys accepted");
        } catch (JSONException expected) { check(true, "duplicate snapshot rejected"); }

        JSONObject edited = new JSONObject(remote.toString()).put("title", "phone edit");
        store.edit("remote", remoteKey, edited);
        JSONArray unsent = store.begin(computer);
        store.end();
        JSONArray reconnect = store.begin(computer);
        check(unsent.toString().equals(reconnect.toString()) && reconnect.length() == 1, "disconnect preserves pending token");
        String token = reconnect.getJSONObject(0).getString("token");
        snapshot.put("results", new JSONArray().put(new JSONObject().put("token", token).put("status", "conflict").put("message", "stale")));
        store.finish(computer, reconnect, snapshot);
        store.end();
        check(store.details().getInt("pending") == 1 && store.details().getJSONArray("conflicts").length() == 1, "conflict retains phone draft");
        store.discard(remoteKey);
        check(store.visible().getJSONObject(0).getString("title").equals("合成测试 Ω"), "conflict resolution restores Windows entry");

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        check(ReminderReceiver.notificationsAllowed(context), "emulator notification permission");
        check(context.getSystemService(AlarmManager.class).canScheduleExactAlarms(), "emulator exact alarm permission");
        JSONObject scheduled = makeEvent(System.currentTimeMillis() + 10_000, "SYNTHETIC Schedule reminder", "shared-alarm-test");
        snapshot.put("events", new JSONArray().put(remote).put(scheduled)).put("results", new JSONArray());
        store.finish(computer, store.begin(computer), snapshot);
        store.end();
        ReminderReceiver.reconcile(context);
        long deadline = SystemClock.elapsedRealtime() + 26_000;
        StatusBarNotification delivered;
        String tag = "remote:" + scheduled.getString("key");
        while ((delivered = find(manager, tag)) == null && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(300);
        check(delivered != null, "AlarmManager delivered a synchronized event reminder with no Bluetooth connection");
        long originalPost = delivered.getPostTime();
        ReminderReceiver.reconcile(context);
        check(find(manager, tag).getPostTime() == originalPost, "reconcile does not post the same reminder twice");
        snapshot.put("events", new JSONArray()).put("results", new JSONArray());
        store.finish(computer, store.begin(computer), snapshot);
        store.end();
        ReminderReceiver.reconcile(context);
        check(find(manager, tag) == null, "replica deletion cancels delivered notification");
        check(store.visible().length() == 0, "empty authoritative snapshot removes deleted shared event");
        verifyWebView(context);
    }

    private StatusBarNotification find(NotificationManager manager, String tag) {
        for (StatusBarNotification item : manager.getActiveNotifications())
            if (tag.equals(item.getTag())) return item;
        return null;
    }

    private String js(WebView view, String code) throws Exception {
        CompletableFuture<String> response = new CompletableFuture<>();
        runOnMainSync(() -> view.evaluateJavascript(code, response::complete));
        return response.get(8, TimeUnit.SECONDS);
    }

    private void drag(WebView web,String target,double rx,double ry,int dx,int dy) throws Exception {
        drag(web,target,rx,ry,dx,dy,18);
    }
    private void drag(WebView web,String target,double rx,double ry,int dx,int dy,int interval) throws Exception {
        JSONArray point=new JSONArray(js(web,"(()=>{const r=document.querySelector("+JSONObject.quote(target)+").getBoundingClientRect();return [r.left+r.width*"+rx+",r.top+r.height*"+ry+",devicePixelRatio]})()"));
        float scale=(float)point.getDouble(2),x=(float)point.getDouble(0)*scale,y=(float)point.getDouble(1)*scale;
        long down=SystemClock.uptimeMillis();
        for(int i=0;i<=15;i++) {
            final int action=i==0?android.view.MotionEvent.ACTION_DOWN:i==15?android.view.MotionEvent.ACTION_UP:android.view.MotionEvent.ACTION_MOVE;
            final float px=x+dx*scale*Math.min(i,14)/14,py=y+dy*scale*Math.min(i,14)/14;
            final long eventTime=down+(long)i*interval;
            runOnMainSync(()->{android.view.MotionEvent e=android.view.MotionEvent.obtain(down,eventTime,action,px,py,0);e.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);web.dispatchTouchEvent(e);e.recycle();});
            SystemClock.sleep(interval);
            if(i==7 && dx!=0)js(web,"window.dragFeedback=[...document.querySelectorAll('.motion-surface')].some(e=>e.style.transform.includes('translate3d')&&!e.style.transform.includes('(0px'))");
        }
        SystemClock.sleep(550);
    }

    private void capture(String name) throws Exception {
        waitForIdleSync();SystemClock.sleep(400);
        android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();
        try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getExternalFilesDir(null),name))) {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);
        } finally {bitmap.recycle();}
    }

    private void showcase() throws Exception {
        Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView web=(WebView)((ViewGroup)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0)).getChildAt(0);
        try {
            for(int i=0;i<60&&!"true".equals(js(web,"typeof window.syncRequest==='function'"));i++)SystemClock.sleep(200);
            SystemClock.sleep(1000);
            String rendered=js(web,"(()=>{try{state=Journal.blank();zh=true;state.projects=[{id:'research',name:'研究笔记'},{id:'product',name:'产品设计'},{id:'reading',name:'阅读与灵感'}];state.ideas=[];"+
                "for(let d=1;d<22;d++){if(d%4===0)continue;for(let i=0;i<1+d%4;i++)state.ideas.push({id:'demo-'+d+'-'+i,date:'2026-11-'+String(d).padStart(2,'0'),text:'留下一个值得继续探索的想法',projects:['research'],state:'note',important:false,due:''});}"+
                "state.ideas.push({id:'today-1',date:'2026-11-22',text:'梳理研究问题，写下今天最值得继续探索的一步。',projects:['research'],state:'note',important:false,due:''},"+
                "{id:'today-2',date:'2026-11-22',text:'整理实验记录，补充关键结论。',projects:['research'],state:'done',important:false,due:''},"+
                "{id:'today-3',date:'2026-11-22',text:'把灵感留在这里，下次接着写。',projects:['reading'],state:'todo',important:false,due:''});"+
                "events={...events,events:[{key:'2026-11-22/demo',title:'原型讨论',time:'14:30',important:true,done:false}],local:[],pending:0};"+
                "state.days['2026-11-22']='让想法慢慢成形';day='2026-11-22';month='2026-11';calendarExpanded=false;selectTab('day');render(false);document.querySelector('#today').textContent='今天';return 'ok';}catch(e){return e.stack;}})()");
            check("\"ok\"".equals(rendered),"showcase renders: "+rendered);
            SystemClock.sleep(600);capture("android-home.png");
            js(web,"expandCalendar(true)");SystemClock.sleep(600);capture("android-calendar.png");
            check(true,"captured current Android app with synthetic showcase content");
        }finally{runOnMainSync(activity::finish);}
    }

    private void verifyGestures() throws Exception {
        Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView web=(WebView)((ViewGroup)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0)).getChildAt(0);
        try {
            for(int i=0;i<40&&!"true".equals(js(web,"!!document.querySelector('.calendar-toggle')"));i++)SystemClock.sleep(200);
            js(web,"day='2034-03-12';month='2034-03';selectTab('day')");
            check("true".equals(js(web,"document.querySelectorAll('.cell').length===7 && !calendarExpanded")),"calendar starts as selected week");
            capture("calendar-compact.png");
            drag(web,".calendar header",.5,.5,0,40);
            check("true".equals(js(web,"calendarExpanded && day==='2034-03-12'")),"short downward pull on month header expands without click toggling back");
            drag(web,".month",.5,.5,30,-110);
            check("true".equals(js(web,"calendarExpanded && screen.scrollTop>30 && month==='2034-03' && !document.querySelector('[data-pull]')")),"expanded date grid scrolls upward without collapsing or changing month");
            js(web,"screen.scrollTop=120;window.beforeCalendarScroll=screen.scrollTop");
            drag(web,".month",.5,.5,18,90);
            check("true".equals(js(web,"calendarExpanded && screen.scrollTop<beforeCalendarScroll && day==='2034-03-12'")),"expanded date grid scrolls downward without collapsing or selecting a date");
            js(web,"screen.scrollTop=0;document.querySelector('.calendar-title').click()");SystemClock.sleep(400);
            drag(web,".month",.5,.4,32,36);
            check("true".equals(js(web,"calendarExpanded && month==='2034-03'")),"diagonal downward pull expands calendar");
            drag(web,".month",.7,.5,-110,50);
            check("true".equals(js(web,"calendarExpanded && month==='2034-04'")),"mostly horizontal diagonal swipe changes month without collapsing");
            js(web,"moveMonth(-1)");
            drag(web,".calendar header",.5,.5,0,-40);
            check("true".equals(js(web,"!calendarExpanded")),"upward pull on month header collapses");
            drag(web,".month",.5,.4,0,24,2);
            check("true".equals(js(web,"calendarExpanded")),"short fast flick expands without requiring a long drag");
            js(web,"document.querySelector('.calendar-title').click()");SystemClock.sleep(400);
            check("true".equals(js(web,"!calendarExpanded && document.querySelector('.calendar-title').getAttribute('aria-expanded')==='false'")),"month title provides accessible collapse fallback");
            drag(web,".week",.5,.5,0,8);
            check("true".equals(js(web,"!calendarExpanded && !document.querySelector('[data-pull]')")),"small slow movement does not accidentally expand calendar");
            js(web,"changeDay('2034-03-12')");
            drag(web,".month",.5,.65,0,100);
            check("true".equals(js(web,"calendarExpanded && document.querySelectorAll('.cell').length===35 && day==='2034-03-12'")),"native downward drag expands month without changing date");
            js(web,"window.overviewOriginal={state,events,zh};state=JSON.parse(JSON.stringify(state));state.ideas.forEach(i=>i.important=false);events={...events,events:["+
                "{key:'2034-03-12/a',title:'研究组讨论',time:'14:00',important:true,done:false},"+
                "{key:'2034-03-12/b',title:'阅读论文',time:'08:30',important:false,done:false},"+
                "{key:'2034-03-12/c',title:'整理实验',time:'16:30',important:false,done:false}]};"+
                "state.ideas.push({id:'overview-due',date:'2034-03-11',text:'提交实验计划',state:'todo',due:'2034-03-14',important:true,projects:[]},"+
                "{id:'overview-done',date:'2034-03-15',text:'数据已备份',state:'done',due:'',important:false,projects:[]});"+
                "state.days['2034-03-13']='整理机器人实验中的新想法';zh=true;render(false)");
            check("true".equals(js(web,"(()=>{const c=document.querySelector('[data-date=\"2034-03-12\"]');return c.offsetHeight>=132 && c.querySelectorAll('.calendar-entry').length===2 && c.querySelector('.entry-title').textContent==='研究组讨论' && c.querySelectorAll('.entry-time')[1].textContent==='08:30' && c.querySelector('.calendar-more').textContent==='+3'})()")),"expanded cells show two ordered event summaries and overflow count");
            check("true".equals(js(web,"document.querySelector('[data-date=\"2034-03-14\"] .entry-title').textContent==='提交实验计划' && document.querySelector('[data-date=\"2034-03-13\"] .entry-title').textContent.includes('机器人') && !!document.querySelector('[data-date=\"2034-03-15\"] .calendar-entry.done')")),"deadline task, note excerpt and completed state appear in month cells");
            SystemClock.sleep(800);
            capture("calendar-expanded.png");
            js(web,"document.querySelector('[data-date=\"2034-03-14\"]').click()");
            SystemClock.sleep(600);
            check("true".equals(js(web,"day==='2034-03-14' && [...document.querySelectorAll('article .body')].some(e=>e.textContent==='提交实验计划') && screen.scrollTop>200")),"tapping deadline date reveals full task even when created on another day");
            js(web,"state=overviewOriginal.state;events=overviewOriginal.events;zh=overviewOriginal.zh;changeDay('2034-03-12')");
            drag(web,".month",.8,.5,-170,3);
            check("true".equals(js(web,"month==='2034-04' && tab==='day' && day==='2034-03-12'")),"date-grid swipe advances month without tab change or accidental date click");
            check("true".equals(js(web,"dragFeedback && !motionRunning && !document.querySelector('.motion-surface') && !document.querySelector('.month').style.transform")),"month follows finger and settles with no residual transform");
            drag(web,".month",.2,.5,170,0);
            check("true".equals(js(web,"month==='2034-03' && tab==='day'")),"date-grid reverse swipe returns month");
            drag(web,".month",.5,.5,30,0);
            check("true".equals(js(web,"month==='2034-03' && !document.querySelector('.month').style.transform && document.querySelector('.month').getAnimations().length===0")),"short swipe springs back without changing month");
            drag(web,".month",.5,.65,0,-105);
            check("true".equals(js(web,"calendarExpanded && document.querySelectorAll('.cell').length===35 && screen.scrollTop>30")),"ordinary upward browsing keeps the full month expanded");
            js(web,"document.querySelector('.calendar-toggle').scrollIntoView({block:'center',behavior:'instant'})");SystemClock.sleep(150);
            drag(web,".calendar-toggle",.5,.5,0,-45);
            check("true".equals(js(web,"!calendarExpanded && document.querySelectorAll('.cell').length===7")),"explicit bottom handle upward drag still collapses month");
            js(web,"document.querySelector('.calendar-toggle').click()");
            check("true".equals(js(web,"calendarExpanded && document.querySelector('.calendar-toggle').getAttribute('aria-expanded')==='true'")),"accessible handle also toggles calendar");
            check("true".equals(js(web,"document.querySelector('.cell.outside-month').click();month==='2034-02' && day==='2034-02-27'")),"adjacent-month date selects date and switches displayed month");
            js(web,"changeDay('2034-03-12');expandCalendar(false)");
            drag(web,"#screen",.8,.8,-180,2);
            check("true".equals(js(web,"tab==='tasks'")),"swipe outside calendar opens Tasks");
            check("true".equals(js(web,"dragFeedback && !motionRunning && !screen.style.transform && !screen.style.opacity")),"page swipe follows finger and restores clean resting state");
            drag(web,"#screen",.8,.8,-180,0);
            check("true".equals(js(web,"tab==='projects'")),"Tasks swipe opens Projects");
            drag(web,".project-row",.8,.5,-180,0);
            check("true".equals(js(web,"tab==='sync' && project===null")),"project-row swipe opens Sync without opening project");
            drag(web,"#screen",.2,.2,180,0);
            check("true".equals(js(web,"tab==='projects'")),"reverse swipe returns to Projects");
            js(web,"document.querySelector('#tabs button').click()");SystemClock.sleep(500);
            check("true".equals(js(web,"tab==='day' && !motionRunning")),"bottom tab tap completes animated navigation");
            js(web,"window.originalMatchMedia=window.matchMedia;window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true}:originalMatchMedia(q);switchTab('tasks')");
            check("true".equals(js(web,"tab==='tasks' && !motionRunning && screen.getAnimations().length===0")),"reduced-motion preference skips navigation animation");
            js(web,"window.matchMedia=originalMatchMedia;selectTab('day');switchMonth(1);selectTab('tasks')");SystemClock.sleep(500);
            check("true".equals(js(web,"tab==='tasks' && month==='2034-03' && !motionRunning")),"new navigation supersedes an unfinished month transition");
            js(web,"selectTab('day');screen.querySelector('.item-tools button').click();activeDraft.area.value='unsaved gesture draft'");
            drag(web,"textarea",.8,.5,-150,0);
            check("true".equals(js(web,"tab==='day' && activeDraft.area.value==='unsaved gesture draft' && !!inlineEditor")),"inline draft survives horizontal editing gesture");
            js(web,"closeEditor();selectTab('tasks');for(let i=0;i<25;i++)screen.append(node('div','scroll fixture '+i,'card'))");
            drag(web,"#screen",.5,.75,3,-260);
            check("true".equals(js(web,"tab==='tasks' && screen.scrollTop>50")),"ordinary vertical swipe scrolls content without changing tab");
            js(web,"changeDay('2034-03-12');expandCalendar(false)");
        } finally {runOnMainSync(activity::finish);}
    }

    private void verifyWebView(Context context) throws Exception {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = startActivitySync(intent);
        ViewGroup overlay = (ViewGroup) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0);
        WebView web = (WebView) overlay.getChildAt(0);
        try {
            for (int tries = 0; tries < 20 && !"true".equals(js(web, "!!document.querySelector('.calendar')")); tries++)
                SystemClock.sleep(300);
            check("true".equals(js(web, "!!document.querySelector('.calendar')")), "Android WebView loaded packaged calendar and native bridge");
            if (android.os.Build.VERSION.SDK_INT >= 30)
                check(overlay.getPaddingTop() > 0 && overlay.getPaddingBottom() > 0, "status and navigation bars sit outside the touch interface");
            check("true".equals(js(web, "openIdea(null, null, true);" +
                    "activeDraft.area.value = 'SYNTHETIC task'; editor.querySelector('[type=submit]').click();" +
                    "selectTab('tasks'); screen.textContent.includes('SYNTHETIC task')")), "touch editor creates a structured task");
            check("true".equals(js(web, "screen.querySelector('.item-tools button').click();" +
                    "activeDraft.area.value = 'SYNTHETIC edited'; inlineEditor.querySelector('[type=submit]').click();" +
                    "screen.textContent.includes('SYNTHETIC edited')")), "existing idea edits inline through the real bridge");

            String png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmVQAAAAASUVORK5CYII=";
            String id = (String) new JSONTokener(js(web, "call('pasteBytes','" + png + "','image/png')")).nextValue();
            File image = new File(new File(context.getFilesDir(), "images"), id);
            check(Arrays.equals(Files.readAllBytes(image.toPath()), android.util.Base64.decode(png, android.util.Base64.DEFAULT)),
                    "attached image bytes are retained unchanged");
            js(web, "showImage(" + JSONObject.quote(id) + ")");
            boolean decoded = false;
            for (int tries = 0; tries < 20; tries++) {
                if ("true".equals(js(web, "preview.open && preview.children.length===1 && preview.firstChild.naturalWidth===1"))) {
                    decoded = true;
                    break;
                }
                SystemClock.sleep(200);
            }
            check(decoded, "preview contains only the decoded image");
            check("true".equals(js(web, "preview.dispatchEvent(new PointerEvent('pointerup',{pointerId:1})); !preview.open")),
                    "tapping outside image closes preview");
        } finally {
            runOnMainSync(activity::finish);
        }
    }
}

