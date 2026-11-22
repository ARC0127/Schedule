package io.github.arc0127.schedule;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;
import org.json.*;

final class Protocol {
    static final UUID SERVICE = UUID.fromString("eb703723-8f0f-4b98-aa19-be0423b0a0c6");
    static final int MAX_FRAME = 4 * 1024 * 1024;
    static final int MAX_EVENTS = 10000;
    static final int MAX_CHANGES = 100;
    static final long MIN_AT = -2208988800000L;
    static final long MAX_AT = 7289654399999L;

    static JSONObject frame(String type) throws JSONException {
        return new JSONObject().put("v", 1).put("type", type);
    }

    static JSONObject read(InputStream stream, String type) throws Exception {
        DataInputStream in = new DataInputStream(stream);
        int size = in.readInt();
        if (size < 2 || size > MAX_FRAME) throw new IOException("Invalid frame size");
        byte[] bytes = new byte[size];
        in.readFully(bytes);
        String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
        JSONTokener parser = new JSONTokener(text);
        Object value = parser.nextValue();
        if (!(value instanceof JSONObject) || parser.nextClean() != 0) throw new IOException("Invalid frame JSON");
        JSONObject frame = (JSONObject) value;
        if("sync-error".equals(frame.optString("type")))throw new IOException("Remote sync failed ("+frame.optString("phase")+"): "+frame.optString("message"));
        if (number(frame, "v") != 1 || !type.equals(frame.getString("type"))) {
            throw new IOException("Unsupported Schedule sync protocol");
        }
        return frame;
    }

    static void write(OutputStream stream, JSONObject message) throws IOException {
        byte[] bytes = message.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FRAME) throw new IOException("Sync frame is too large");
        DataOutputStream out = new DataOutputStream(stream);
        out.writeInt(bytes.length);
        out.write(bytes);
        out.flush();
    }

    static String string(JSONObject object, String field) throws JSONException {
        Object value = object.get(field);
        if (!(value instanceof String)) throw new JSONException("Invalid " + field);
        return (String) value;
    }

    static long number(JSONObject object, String field) throws JSONException {
        Object value = object.get(field);
        if (!(value instanceof Integer) && !(value instanceof Long)) throw new JSONException("Invalid " + field);
        return ((Number) value).longValue();
    }

    static boolean bool(JSONObject object, String field) throws JSONException {
        Object value = object.get(field);
        if (!(value instanceof Boolean)) throw new JSONException("Invalid " + field);
        return (Boolean) value;
    }

    static String checkedDate(String value) throws JSONException {
        try {
            int year = LocalDate.parse(value).getYear();
            if (value.length() == 10 && year >= 1900 && year <= 2200) return value;
        } catch (RuntimeException ignored) {}
        throw new JSONException("Invalid date");
    }

    static String checkedKey(String key) throws JSONException {
        if (!key.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-zA-Z0-9-]{1,80}")) throw new JSONException("Invalid event key");
        checkedDate(key.substring(0, 10));
        return key;
    }

    static JSONObject event(JSONObject value) throws Exception {
        String key = checkedKey(string(value, "key"));
        String title = string(value, "title");
        String time = string(value, "time");
        long at = number(value, "at");
        long minutes = number(value, "minutes");
        if (title.trim().isEmpty() || title.length() > 100 || !time.matches("[0-9]{2}:[0-9]{2}")
                || at < MIN_AT || at > MAX_AT || !Arrays.asList(-1L, 0L, 5L, 15L, 30L, 60L).contains(minutes)) {
            throw new JSONException("Invalid event");
        }
        LocalTime.parse(time);
        return new JSONObject().put("key", key).put("title", title).put("time", time)
                .put("at", at).put("minutes", minutes).put("done", bool(value, "done"))
                .put("important", bool(value, "important")).put("locked", bool(value, "locked"));
    }

    static JSONObject snapshot(JSONArray events) throws Exception {
        if (events.length() > MAX_EVENTS) throw new JSONException("Too many events");
        JSONObject index = new JSONObject();
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = event(events.getJSONObject(i));
            String key = event.getString("key");
            if (index.has(key)) throw new JSONException("Duplicate event key");
            index.put(key, event);
        }
        return index;
    }
}

