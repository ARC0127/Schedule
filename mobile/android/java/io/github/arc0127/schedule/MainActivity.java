package io.github.arc0127.schedule;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import android.util.AtomicFile;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class MainActivity extends Activity {
    private static final String HOST = "schedule.local";
    private static final int IMAGE = 10, DOCUMENT = 11, TREE = 12, IMPORT = 13, EXPORT = 14, SAVE_IMAGE = 15, BACKUP = 16, RESTORE = 17;
    private static final int MAX_MARKDOWN = 8 * 1024 * 1024;
    private static final int MAX_JOURNAL = 100 * 1024 * 1024;
    private static final int MAX_IMAGE = 64 * 1024 * 1024;
    private static final Set<String> IMAGE_TYPES = new HashSet<>(Arrays.asList(
            "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/heic", "image/heif"));
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private AtomicFile journal;
    private EventStore events;
    private BluetoothSync sync;
    private boolean zh;
    private volatile String syncStatus = "idle";
    private String exportText = "";
    private String imageToSave = "";
    private volatile boolean journalBusy;
    private final Map<String,CompletableFuture<JSONObject>> syncReplies=new ConcurrentHashMap<>();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        zh = getResources().getConfiguration().getLocales().get(0).getLanguage().equals("zh");
        journal = new AtomicFile(new File(getFilesDir(), "journal.json"));
        try {
            DataBackup.recover(this);
            events = EventStore.get(this);
            File upgraded=new File(getFilesDir(),"full-sync-backup-ready");
            if(!upgraded.isFile()) {DataBackup.snapshot(this,"before-full-sync-upgrade");DataBackup.write(upgraded,new byte[]{1});}
        } catch (Exception error) {
            new AlertDialog.Builder(this).setTitle("Schedule").setMessage(error.getMessage())
                    .setPositiveButton(android.R.string.ok, (d, i) -> finish()).show();
            return;
        }
        if (state != null) {
            exportText = state.getString("export", "");
            imageToSave = state.getString("image", "");
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(245, 248, 245));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebChromeClient(new WebChromeClient());
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "NativeSchedule");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }

            @Override public void onPageFinished(WebView view, String url) {
                openIntent(getIntent());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String path = url.getPath();
                if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost()) || path == null) return missing();
                try {
                    if (path.startsWith("/image/")) {
                        String[] ref = imageRef(path.substring(7));
                        return new WebResourceResponse(ref[1], null, new FileInputStream(new File(images(), ref[0])));
                    }
                    if (!path.matches("/[a-zA-Z0-9._/-]+") || path.contains("..")) return missing();
                    String type = path.endsWith(".js") ? "application/javascript"
                            : path.endsWith(".css") ? "text/css"
                            : path.endsWith(".woff2") ? "font/woff2"
                            : path.endsWith(".woff") ? "font/woff"
                            : path.endsWith(".ttf") ? "font/ttf" : "text/html";
                    return new WebResourceResponse(type, type.startsWith("font/") ? null : "UTF-8",
                            getAssets().open(path.substring(1)));
                } catch (Exception ignored) { return missing(); }
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 248, 245));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                // The container has already applied these insets to the WebView's bounds.
                return new WindowInsets.Builder(insets)
                        .setInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime(),
                                android.graphics.Insets.NONE)
                        .build();
            });
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setStatusBarColor(Color.rgb(245, 248, 245));
        getWindow().setNavigationBarColor(Color.WHITE);
        setContentView(root);
        root.requestApplyInsets();
        web.loadUrl("https://" + HOST + "/index.html");
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onResume() {
        super.onResume();
        reschedule();
        emit("permissions", new JSONObject());
    }

    @Override protected void onStop() {
        stopSync();
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("NativeSchedule");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (exportText.length() < 200000) state.putString("export", exportText);
        state.putString("image", imageToSave);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openIntent(intent);
    }

    @Override public void onBackPressed() {
        if (web != null) web.evaluateJavascript("window.back()", consumed -> {
            if (!"true".equals(consumed)) finish();
        });
        else finish();
    }

    private void openIntent(Intent intent) {
        Uri data = intent.getData();
        if (data != null && "schedule".equals(data.getScheme())) {
            String path = data.getSchemeSpecificPart();
            if (path != null && path.matches("day/[0-9]{4}-[0-9]{2}-[0-9]{2}")) {
                emit("day", path.substring(4));
                intent.setData(null);
            }
        }
    }

    private void emit(String name, Object payload) {
        ui.post(() -> {
            if (web != null) {
                String value = payload instanceof String ? JSONObject.quote((String) payload) : payload.toString();
                web.evaluateJavascript("window.receive?.(" + JSONObject.quote(name) + "," + value + ")", null);
            }
        });
    }

    private void reschedule() {
        if (events == null) return;
        runWorker(() -> ReminderReceiver.reconcile(this));
    }

    private void runWorker(Work action) {
        new Thread(() -> {
            try { action.run(); }
            catch (Exception error) { emit("error", message(error)); }
        }, "Schedule files").start();
    }

    private String message(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private interface Work { void run() throws Exception; }
    private interface Query { Object run() throws Exception; }

    private String result(Query action) {
        try { return new JSONObject().put("ok", true).put("value", action.run()).toString(); }
        catch (Exception error) {
            try { return new JSONObject().put("ok", false).put("error", message(error)).toString(); }
            catch (JSONException impossible) { return "{\"ok\":false}"; }
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean allowed(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean bluetoothAllowed() {
        return Build.VERSION.SDK_INT < 31 || allowed(Manifest.permission.BLUETOOTH_CONNECT);
    }

    private JSONObject permissions() throws Exception {
        AlarmManager alarms = getSystemService(AlarmManager.class);
        JSONArray paired = new JSONArray();
        boolean bluetooth = false;
        BluetoothAdapter adapter = adapter();
        if (adapter != null && bluetoothAllowed()) {
            bluetooth = adapter.isEnabled();
            if (bluetooth) {
                for (BluetoothDevice device : adapter.getBondedDevices()) {
                    paired.put(new JSONObject().put("name", device.getName()).put("address", device.getAddress()));
                }
            }
        }
        return new JSONObject().put("bluetoothPermission", bluetoothAllowed()).put("bluetooth", bluetooth)
                .put("wifiPermission",allowed(Build.VERSION.SDK_INT>=33?Manifest.permission.NEARBY_WIFI_DEVICES:Manifest.permission.ACCESS_FINE_LOCATION))
                .put("exact", Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms())
                .put("notify", ReminderReceiver.notificationsAllowed(this)).put("paired", paired)
                .put("status", syncStatus).put("language", zh ? "zh" : "en");
    }

    private void startSync(String address) throws Exception {
        requireIdle();
        BluetoothAdapter adapter = adapter();
        if (!bluetoothAllowed()) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 1);
            return;
        }
        if (adapter == null || !adapter.isEnabled()) throw new IOException(zh ? "请先打开蓝牙。" : "Turn on Bluetooth first.");
        if (!BluetoothAdapter.checkBluetoothAddress(address)
                || adapter.getRemoteDevice(address).getBondState() != BluetoothDevice.BOND_BONDED) {
            throw new IOException(zh ? "请先在系统中配对电脑。" : "Pair the computer in system settings first.");
        }
        stopSync();
        final BluetoothSync[] session = new BluetoothSync[1];
        session[0] = new BluetoothSync(this,adapter, events, address, () -> {
            emit("events", new JSONObject());
            reschedule();
        }, status -> ui.post(() -> {
            if (sync != session[0]) return;
            setSyncStatus(status);
        }), fullJournalAccess());
        sync = session[0];
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setSyncStatus("starting");
        sync.start();
    }

    JournalTransfer.Access fullJournalAccess() {
        return new JournalTransfer.Access() {
            public SyncAssets assets()throws Exception{return new SyncAssets(images());}
            public JSONObject prepare(String source)throws Exception{return prepare(source,false);}
            public JSONObject prepare(String source,boolean batched) throws Exception {
                synchronized(DataBackup.LOCK) {
                    if(journalBusy)throw new IOException("Finish the current data operation first");
                    events.begin(source);journalBusy=true;
                }
                return journalQuery("export",new JSONObject().put("source",source).put("batched",batched));
            }
            public void apply(String source,JSONObject sent,JSONObject response) throws Exception {
                JSONObject originalAssets=response.getJSONObject("assets");
                for(Iterator<String> it=originalAssets.keys();it.hasNext();){String id=it.next();JSONObject asset=originalAssets.getJSONObject(id);if(asset.optBoolean("ref")&&!assets().has(id))throw new IOException("Missing original: "+id);}
                JSONObject prepared=journalQuery("apply",new JSONObject().put("sent",sent).put("response",response));
                synchronized(DataBackup.LOCK) {
                    Map<String,byte[]> files=DataBackup.captureMetadata(MainActivity.this);
                    files.put("journal.json",prepared.getJSONObject("journal").toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject remote=Protocol.snapshot(prepared.getJSONArray("events"));
                    JSONObject eventState=new JSONObject().put("local",new JSONObject()).put("remote",remote).put("outbox",new JSONObject()).put("source",source).put("lastSync",System.currentTimeMillis());
                    files.put("events.json",eventState.toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject alarms=DataBackup.json(files.get("alarms.json"));
                    List<String> oldKeys=new ArrayList<>();for(Iterator<String> it=alarms.keys();it.hasNext();)oldKeys.add(it.next());
                    for(String key:oldKeys)if(key.startsWith("local:")&&remote.has(key.substring(6))) {
                        String shared="remote:"+key.substring(6);if(!alarms.has(shared))alarms.put(shared,alarms.get(key));alarms.remove(key);
                    }
                    files.put("alarms.json",alarms.toString().getBytes(StandardCharsets.UTF_8));
                    JSONObject assets=response.getJSONObject("assets");
                    for(Iterator<String> it=assets.keys();it.hasNext();) {
                        String id=it.next();if(!DataBackup.imageName(id))throw new IOException("Invalid image identity");
                        if(assets.getJSONObject(id).optBoolean("ref"))continue;
                        byte[] bytes=android.util.Base64.decode(assets.getJSONObject(id).getString("data"),android.util.Base64.NO_WRAP);
                        if(!id.startsWith(DataBackup.hash(bytes)+"."))throw new IOException("Original image checksum mismatch");
                        files.put("images/"+id,bytes);
                    }
                    DataBackup.commitMetadata(MainActivity.this,files);events.reload();
                }
            }
            public void end() {synchronized(DataBackup.LOCK){journalBusy=false;events.end();}emit("journal",new JSONObject());}
        };
    }

    private long lastImageStatus;
    private void setSyncStatus(String status) {
        if(status.startsWith("images-")){long now=android.os.SystemClock.elapsedRealtime();if(now-lastImageStatus<200)return;lastImageStatus=now;}
        syncStatus = status;
        emit("status", status);
    }

    private JSONObject journalQuery(String operation,JSONObject payload) throws Exception {
        String id=UUID.randomUUID().toString();CompletableFuture<JSONObject> response=new CompletableFuture<>();syncReplies.put(id,response);
        ui.post(()->{if(web==null)response.completeExceptionally(new IOException("Schedule is closed"));else web.evaluateJavascript("window.syncRequest("+JSONObject.quote(id)+","+JSONObject.quote(operation)+","+payload.toString()+")",null);});
        try {return response.get(90,TimeUnit.SECONDS);}finally{syncReplies.remove(id);}
    }

    private void requireIdle() throws IOException {if(journalBusy)throw new IOException(zh?"正在同步或恢复，请稍候。":"Sync or restore in progress. Please wait.");}

    private void stopSync() {
        if (sync == null) return;
        sync.close();
        sync = null;
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setSyncStatus("idle");
        setSyncStatus("idle");
    }

    private File images() throws IOException {
        File directory = new File(getFilesDir(), "images");
        if (!directory.isDirectory() && !directory.mkdir()) throw new IOException("Image storage is unavailable");
        return directory;
    }

    private String[] imageRef(String id) throws IOException {
        if (!DataBackup.imageName(id)) throw new IOException("Invalid image reference");
        return new String[]{id, "image/" + id.substring(id.lastIndexOf('.') + 1)};
    }

    private String copyImage(InputStream input, String mime) throws Exception {
        if (!IMAGE_TYPES.contains(mime)) throw new IOException(zh ? "此图片格式不受支持。" : "Unsupported image format.");
        String id = UUID.randomUUID() + "." + mime.substring(6);
        AtomicFile file = new AtomicFile(new File(images(), id));
        FileOutputStream out = file.startWrite();
        try {
            if (transfer(input, out, MAX_IMAGE) == 0) throw new IOException("Empty image");
            file.finishWrite(out);
            return id;
        } catch (Exception error) {
            file.failWrite(out);
            throw error;
        }
    }

    private static int transfer(InputStream in, OutputStream out, int limit) throws IOException {
        if (in == null || out == null) throw new IOException("Could not open the selected document");
        byte[] buffer = new byte[32768];
        int total = 0;
        for (int length; (length = in.read(buffer)) != -1;) {
            total += length;
            if (total > limit) throw new IOException("File exceeds the supported size");
            out.write(buffer, 0, length);
        }
        return total;
    }

    private void pasteImage() {
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        ClipData clip = clipboard.getPrimaryClip();
        Uri uri = clip == null || clip.getItemCount() == 0 ? null : clip.getItemAt(0).getUri();
        if (uri == null || !"content".equals(uri.getScheme())) {
            emit("error", zh ? "剪贴板没有可读取的图片。可从文件选取原图。" : "No readable image on the clipboard. Choose the original file instead.");
            return;
        }
        runWorker(() -> importImage(uri));
    }

    private void importImage(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            emit("image", copyImage(in, getContentResolver().getType(uri)));
        }
    }

    private void pick(int request, String value) {
        Intent intent;
        if (request == EXPORT || request == SAVE_IMAGE || request == BACKUP) {
            intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            if (request == EXPORT) {
                exportText = value;
                intent.setType("text/markdown").putExtra(Intent.EXTRA_TITLE, "Schedule.md");
            } else if(request==BACKUP) {
                intent.setType("application/zip").putExtra(Intent.EXTRA_TITLE,"Schedule-backup.zip");
            } else {
                try {
                    String[] image = imageRef(value);
                    imageToSave = image[0];
                    intent.setType(image[1]).putExtra(Intent.EXTRA_TITLE, "Schedule-" + image[0]);
                } catch (IOException error) { emit("error", message(error)); return; }
            }
        } else if (request == TREE) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(request == IMAGE ? "image/*" : "*/*");
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(intent, request);
    }

    private String name(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {}
        return zh ? "文档" : "Document";
    }

    private boolean granted(Uri uri) {
        for (UriPermission grant : getContentResolver().getPersistedUriPermissions()) {
            if (grant.isReadPermission() && grant.getUri().equals(uri)) return true;
        }
        return false;
    }

    private void openDocument(Uri uri, String mime) throws IOException {
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime == null ? "*/*" : mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivity(intent); }
        catch (ActivityNotFoundException error) { throw new IOException(zh ? "没有可打开此文件的应用。" : "No app can open this file."); }
    }

    private void browseTree(Uri tree, String root) {
        runWorker(() -> {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, root);
            String[] fields = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE};
            List<String[]> rows = new ArrayList<>();
            try (Cursor cursor = getContentResolver().query(children, fields, null, null, null)) {
                if (cursor != null) while (cursor.moveToNext()) rows.add(new String[]{cursor.getString(0), cursor.getString(1), cursor.getString(2)});
            }
            rows.sort(Comparator.comparing(row -> row[1], String.CASE_INSENSITIVE_ORDER));
            String[] labels = rows.stream().map(row -> row[1]).toArray(String[]::new);
            ui.post(() -> new AlertDialog.Builder(this).setTitle(zh ? "文件夹" : "Folder")
                    .setItems(labels, (dialog, index) -> {
                        String[] row = rows.get(index);
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(row[2])) browseTree(tree, row[0]);
                        else try { openDocument(DocumentsContract.buildDocumentUriUsingTree(tree, row[0]), row[2]); }
                        catch (Exception error) { emit("error", message(error)); }
                    }).setNegativeButton(android.R.string.cancel, null).show());
        });
    }

    @Override protected void onActivityResult(int request, int status, Intent data) {
        super.onActivityResult(request, status, data);
        if (status != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        String text = exportText;
        String selectedImage = imageToSave;
        runWorker(() -> {
            if(request==BACKUP) {
                synchronized(DataBackup.LOCK) {requireIdle();DataBackup.export(this,getContentResolver().openOutputStream(uri,"wt"));}
                emit("exported",new JSONObject());
            } else if(request==RESTORE) {
                Map<String,byte[]> restored=DataBackup.readZip(getContentResolver().openInputStream(uri));
                ui.post(()->new AlertDialog.Builder(this).setTitle(zh?"恢复完整备份":"Restore complete backup")
                    .setMessage(zh?"将恢复备份中的笔记、想法、项目、原图与日程。恢复前会保留当前数据的完整备份。外部文件可能需要重新授权。":"Restore notes, ideas, projects, original images and events. Current data is backed up first. External documents may need permission again.")
                    .setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->runWorker(()->{
                        synchronized(DataBackup.LOCK){requireIdle();journalBusy=true;try{DataBackup.commit(this,restored);events.reload();}finally{journalBusy=false;}}
                        emit("journal",new JSONObject());reschedule();
                    })).show());
            } else if (request == IMAGE) importImage(uri);
            else if (request == DOCUMENT || request == TREE) {
                getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                boolean tree = request == TREE;
                String label = tree ? name(DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))) : name(uri);
                emit("reference", new JSONObject().put("name", label).put("uri", uri.toString()).put("tree", tree));
            } else if (request == IMPORT) {
                try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    transfer(in, out, MAX_MARKDOWN);
                    emit("markdown", out.toString("UTF-8"));
                }
            } else if (request == EXPORT) {
                if (text.isEmpty()) throw new IOException("Export was interrupted; start it again.");
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    transfer(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), out, MAX_MARKDOWN);
                }
                emit("exported", new JSONObject());
            } else if (request == SAVE_IMAGE) {
                String[] image = imageRef(selectedImage);
                try (InputStream in = new FileInputStream(new File(images(), image[0]));
                     OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    transfer(in, out, MAX_IMAGE);
                }
                emit("exported", new JSONObject());
            }
        });
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        reschedule();
        emit("permissions", new JSONObject());
    }

    private final class Bridge {
        @JavascriptInterface public String resolveSync(String value) {return result(()->{
            synchronized(DataBackup.LOCK) {
                requireIdle();JSONObject prepared=new JSONObject(value);Map<String,byte[]> files=DataBackup.captureMetadata(MainActivity.this);
                JSONObject eventState=events.raw();eventState.put("local",new JSONObject()).put("remote",Protocol.snapshot(prepared.getJSONArray("events"))).put("outbox",new JSONObject());
                files.put("events.json",eventState.toString().getBytes(StandardCharsets.UTF_8));
                files.put("journal.json",prepared.getJSONObject("journal").toString().getBytes(StandardCharsets.UTF_8));
                DataBackup.commitMetadata(MainActivity.this,files);events.reload();reschedule();return true;
            }
        });}
        @JavascriptInterface public void syncReply(String id,String text) {
            CompletableFuture<JSONObject> reply=syncReplies.get(id);if(reply==null)return;
            try {JSONObject value=new JSONObject(text);if(!value.getBoolean("ok"))throw new IOException(value.getString("error"));reply.complete(value.getJSONObject("value"));}
            catch(Exception e){reply.completeExceptionally(e);}
        }
        @JavascriptInterface public String syncState() {return result(events::raw);}
        @JavascriptInterface public String imageDescriptor(String id){return result(()->new SyncAssets(images()).describe(id));}
        @JavascriptInterface public String imageData(String id) {return result(()->{
            String[] info=imageRef(id);byte[] bytes=Files.readAllBytes(new File(images(),info[0]).toPath());
            return "data:"+info[1]+";base64,"+android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP);
        });}
        @JavascriptInterface public String settings() { return result(MainActivity.this::permissions); }
        @JavascriptInterface public String entries() { return result(events::details); }

        @JavascriptInterface public String load() {
            return result(() -> {
                try { return new JSONObject(new String(journal.readFully(), StandardCharsets.UTF_8)); }
                catch (FileNotFoundException none) { return new JSONObject(); }
            });
        }

        @JavascriptInterface public String save(String value) {
            return result(() -> {
                synchronized(DataBackup.LOCK) {requireIdle();
                byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_JOURNAL) throw new IOException("Journal exceeds 100 MiB");
                new JSONObject(value);
                FileOutputStream out = journal.startWrite();
                try { out.write(bytes); journal.finishWrite(out); }
                catch (Exception error) { journal.failWrite(out); throw error; }
                return true;
                }
            });
        }

        @JavascriptInterface public String event(String scope, String key, String value) {
            return result(() -> {
                synchronized(DataBackup.LOCK) {requireIdle();
                events.edit(scope, key, value.isEmpty() ? null : new JSONObject(value));
                reschedule();
                return events.details();
                }
            });
        }

        @JavascriptInterface public String discard(String key) {
            return result(() -> {
                events.discard(key);
                reschedule();
                return events.details();
            });
        }

        @JavascriptInterface public String keepCopy(String key) {
            return result(() -> {
                events.keepCopy(key);
                reschedule();
                return events.details();
            });
        }

        @JavascriptInterface public String unlink() {
            return result(() -> {
                events.unlink();
                reschedule();
                return events.details();
            });
        }

        @JavascriptInterface public String pasteBytes(String bytes, String mime) {
            return result(() -> {
                if (bytes.length() > (MAX_IMAGE / 3 + 1) * 4) throw new IOException("Image exceeds 64 MiB");
                return copyImage(new ByteArrayInputStream(android.util.Base64.decode(bytes, android.util.Base64.DEFAULT)), mime);
            });
        }

        @JavascriptInterface public void action(String action, String value) {
            ui.post(() -> {
                try {
                    switch (action) {
                        case "bluetoothPermission":
                            if (Build.VERSION.SDK_INT >= 31) requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 1);
                            break;
                        case "bluetoothSettings": startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); break;
                        case "wifiPermission": requestPermissions(new String[]{Build.VERSION.SDK_INT>=33?Manifest.permission.NEARBY_WIFI_DEVICES:Manifest.permission.ACCESS_FINE_LOCATION},3);break;
                        case "sync": startSync(value); break;
                        case "stop": stopSync(); break;
                        case "notification":
                            if (Build.VERSION.SDK_INT >= 33 && !allowed(Manifest.permission.POST_NOTIFICATIONS)) {
                                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
                            } else {
                                startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                            }
                            break;
                        case "exact":
                            if (Build.VERSION.SDK_INT >= 31) startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                    Uri.parse("package:" + getPackageName())));
                            break;
                        case "image": pick(IMAGE, ""); break;
                        case "pasteImage": pasteImage(); break;
                        case "file": pick(DOCUMENT, ""); break;
                        case "folder": pick(TREE, ""); break;
                        case "import": pick(IMPORT, ""); break;
                        case "export": pick(EXPORT, value); break;
                        case "backup": requireIdle();pick(BACKUP, value);break;
                        case "restore": requireIdle();pick(RESTORE, value);break;
                        case "saveImage": pick(SAVE_IMAGE, value); break;
                        case "link": {
                            Uri uri = Uri.parse(value);
                            if (("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                                    && uri.getHost() != null) startActivity(new Intent(Intent.ACTION_VIEW, uri));
                            break;
                        }
                        case "reference": {
                            Uri uri = Uri.parse(value);
                            if (!granted(uri)) throw new IOException(zh ? "授权已失效，请重新关联。" : "Access expired. Link the file again.");
                            if (DocumentsContract.isTreeUri(uri)) browseTree(uri, DocumentsContract.getTreeDocumentId(uri));
                            else openDocument(uri, getContentResolver().getType(uri));
                            break;
                        }
                        default: break;
                    }
                } catch (Exception error) { emit("error", message(error)); }
            });
        }
    }
}

