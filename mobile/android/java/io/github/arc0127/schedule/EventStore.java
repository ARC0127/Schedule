package io.github.arc0127.schedule;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

final class EventStore {
    private static EventStore instance;
    private final AtomicFile file;
    private JSONObject state;
    private boolean syncing;

    static synchronized EventStore get(Context context) throws Exception {
        if (instance == null) {DataBackup.recover(context);instance = new EventStore(context.getApplicationContext());}
        return instance;
    }

    private EventStore(Context context) throws Exception {
        file = new AtomicFile(new File(context.getFilesDir(), "events.json"));
        try {
            state = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException missing) {
            state = new JSONObject().put("local", new JSONObject()).put("remote", new JSONObject())
                    .put("outbox", new JSONObject()).put("source", "").put("lastSync", 0);
        }
    }

    private void commit(JSONObject updated) throws Exception {
        FileOutputStream out = file.startWrite();
        try {
            out.write(updated.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
            state = updated;
        } catch (Exception error) {
            file.failWrite(out);
            throw error;
        }
    }

    private JSONObject copy() throws JSONException {
        return new JSONObject(state.toString());
    }

    synchronized JSONArray visible() throws Exception {
        return new JSONArray(visibleMap().values());
    }

    synchronized Map<String, JSONObject> visibleMap() throws Exception {
        Map<String, JSONObject> rows = new TreeMap<>();
        for (String scope : new String[]{"local", "remote"}) {
            JSONObject source = state.getJSONObject(scope);
            for (Iterator<String> it = source.keys(); it.hasNext();) {
                String key = it.next();
                rows.put(scope + ":" + key, new JSONObject(source.getJSONObject(key).toString()).put("scope", scope));
            }
        }
        JSONObject outbox = state.getJSONObject("outbox");
        for (Iterator<String> it = outbox.keys(); it.hasNext();) {
            String key = it.next();
            JSONObject change = outbox.getJSONObject(key);
            String identity = "remote:" + key;
            JSONObject event = change.optJSONObject("value");
            if (event == null) rows.remove(identity);
            else rows.put(identity, new JSONObject(event.toString()).put("scope", "remote").put("pending", true));
        }
        return rows;
    }

    synchronized JSONObject details() throws Exception {
        JSONObject outbox = state.getJSONObject("outbox");
        JSONArray conflicts = new JSONArray();
        String retry = "";
        for (Iterator<String> it = outbox.keys(); it.hasNext();) {
            String key = it.next();
            JSONObject change = outbox.getJSONObject(key);
            if (change.has("problem")) {
                JSONObject conflict = new JSONObject(change.toString());
                JSONObject latest = state.getJSONObject("remote").optJSONObject(key);
                conflicts.put(conflict.put("windows", latest == null ? JSONObject.NULL : latest));
            }
            if (retry.isEmpty()) retry = change.optString("retry", "");
        }
        return new JSONObject().put("events", visible()).put("source", state.getString("source"))
                .put("lastSync", state.getLong("lastSync")).put("pending", outbox.length())
                .put("conflicts", conflicts).put("retry", retry);
    }

    synchronized void edit(String scope, String key, JSONObject raw) throws Exception {
        Protocol.checkedKey(key);
        if (syncing) throw new IOException("Sync is in progress. Try again when it finishes.");
        JSONObject updated = copy();
        JSONObject value = raw == null ? null : Protocol.event(raw);
        if (value != null && !key.equals(value.getString("key"))) throw new JSONException("Event key mismatch");
        if ("local".equals(scope)) {
            JSONObject local = updated.getJSONObject("local");
            if (value == null) local.remove(key);
            else local.put(key, value.put("locked", false));
        } else if ("remote".equals(scope)) {
            JSONObject outbox = updated.getJSONObject("outbox");
            JSONObject remote = updated.getJSONObject("remote").optJSONObject(key);
            JSONObject previous = outbox.optJSONObject(key);
            if (remote != null && remote.getBoolean("locked")) throw new IOException("Edit this linked or legacy event in Windows");
            if (updated.getString("source").isEmpty()) throw new IOException("Sync with Windows before creating a shared event");
            if (value == null && remote == null && previous != null && previous.isNull("base")) {
                outbox.remove(key);
            } else {
                if (previous == null && remote == null && (value == null || !key.substring(11).startsWith("android-"))) {
                    throw new IOException("Event no longer exists");
                }
                if (previous == null && outbox.length() >= Protocol.MAX_CHANGES) throw new IOException("Sync the pending changes first");
                Object base = previous != null ? previous.get("base") : remote;
                JSONObject change = new JSONObject().put("key", key).put("token", UUID.randomUUID().toString())
                        .put("base", base == null ? JSONObject.NULL : base)
                        .put("value", value == null ? JSONObject.NULL : value.put("locked", false));
                if (previous != null && previous.has("problem")) change.put("problem", previous.getString("problem"));
                outbox.put(key, change);
            }
        } else throw new JSONException("Invalid event scope");
        commit(updated);
    }

    synchronized JSONArray begin(String source) throws Exception {
        if (syncing) throw new IOException("Sync already in progress");
        if (!source.matches("[a-f0-9]{64}")) throw new IOException("Invalid computer identity");
        String current = state.getString("source");
        if (!current.isEmpty() && !current.equals(source)) throw new IOException("This phone is linked to another Schedule data source");
        JSONArray changes = new JSONArray();
        JSONObject outbox = state.getJSONObject("outbox");
        for (Iterator<String> it = outbox.keys(); it.hasNext();) {
            JSONObject change = outbox.getJSONObject(it.next());
            if (!change.has("problem")) changes.put(change);
        }
        syncing = true;
        return changes;
    }

    synchronized void finish(String source, JSONArray sent, JSONObject response) throws Exception {
        if (!syncing || !source.equals(Protocol.string(response, "source"))) throw new IOException("Sync identity mismatch");
        JSONObject updated = copy();
        JSONObject remote = Protocol.snapshot(response.getJSONArray("events"));
        JSONObject outbox = updated.getJSONObject("outbox");
        JSONArray results = response.getJSONArray("results");
        if (results.length() != sent.length()) throw new IOException("Missing sync results");
        for (int i = 0; i < sent.length(); i++) {
            JSONObject change = sent.getJSONObject(i);
            JSONObject result = results.getJSONObject(i);
            if (!change.getString("token").equals(Protocol.string(result, "token"))) throw new IOException("Sync result mismatch");
            String key = change.getString("key");
            String status = Protocol.string(result, "status");
            if ("applied".equals(status)) outbox.remove(key);
            else if ("conflict".equals(status)) {
                JSONObject outstanding = outbox.getJSONObject(key);
                outstanding.remove("retry");
                outstanding.put("problem", Protocol.string(result, "message"));
            } else if ("retry".equals(status)) {
                outbox.getJSONObject(key).put("retry", Protocol.string(result, "message"));
            } else throw new IOException("Invalid sync result");
        }
        updated.put("source", source).put("remote", remote).put("lastSync", System.currentTimeMillis());
        commit(updated);
    }

    synchronized void end() {
        syncing = false;
    }

    synchronized JSONObject raw() throws Exception {return copy();}
    synchronized void reload() throws Exception {state=new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8));}

    synchronized void discard(String key) throws Exception {
        if (syncing) throw new IOException("Sync is in progress");
        JSONObject updated = copy();
        updated.getJSONObject("outbox").remove(Protocol.checkedKey(key));
        commit(updated);
    }

    synchronized void keepCopy(String key) throws Exception {
        if (syncing) throw new IOException("Sync is in progress");
        JSONObject updated = copy();
        JSONObject outbox = updated.getJSONObject("outbox");
        JSONObject event = Protocol.event(outbox.getJSONObject(Protocol.checkedKey(key)).getJSONObject("value"));
        String localKey = key.substring(0, 11) + "android-" + UUID.randomUUID();
        // An already-armed occurrence reappears under the Windows key when the draft is resolved.
        // Keep the copy silent until its reminder is enabled explicitly.
        updated.getJSONObject("local").put(localKey, event.put("key", localKey).put("minutes", -1));
        outbox.remove(key);
        commit(updated);
    }

    synchronized void unlink() throws Exception {
        if (syncing) throw new IOException("Sync is in progress");
        if (state.getJSONObject("outbox").length() != 0) throw new IOException("Resolve or discard pending changes first");
        JSONObject updated = copy();
        updated.put("source", "").put("remote", new JSONObject()).put("lastSync", 0);
        commit(updated);
    }
}

