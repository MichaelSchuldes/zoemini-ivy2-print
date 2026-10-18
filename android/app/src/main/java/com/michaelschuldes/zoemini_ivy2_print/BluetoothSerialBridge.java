package com.michaelschuldes.zoemini_ivy2_print;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

public class BluetoothSerialBridge {
    private static final String TAG = "BluetoothSerialBridge";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");

    private final Context context;
    private BluetoothSocket socket;
    private InputStream inputStream;
    private OutputStream outputStream;

    public BluetoothSerialBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public boolean isAvailable() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        return adapter != null && adapter.isEnabled();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public String getBondedDevices() {
        JSONArray array = new JSONArray();
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null) {
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null) {
                    for (BluetoothDevice dev : bonded) {
                        JSONObject obj = new JSONObject();
                        obj.put("name", dev.getName() != null ? dev.getName() : "Unknown");
                        obj.put("address", dev.getAddress());
                        array.put(obj);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get bonded devices", e);
        }
        return array.toString();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public String connect(String address) {
        disconnect();
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                return "Bluetooth is not enabled on this device.";
            }

            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device == null) {
                return "Device not found for address: " + address;
            }

            // Always cancel discovery before connecting to prevent RFCOMM throughput degradation
            adapter.cancelDiscovery();

            Log.i(TAG, "Attempting insecure RFCOMM connection to " + address);
            BluetoothSocket s = null;
            try {
                s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                s.connect();
            } catch (Exception e1) {
                Log.w(TAG, "Standard insecure SDP socket failed, falling back to reflection channel 1: " + e1.getMessage());
                try {
                    Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                    s = (BluetoothSocket) m.invoke(device, 1);
                    if (s != null) {
                        s.connect();
                    }
                } catch (Exception e2) {
                    Log.w(TAG, "Reflection channel 1 failed, trying secure SDP: " + e2.getMessage());
                    s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    s.connect();
                }
            }

            if (s == null || !s.isConnected()) {
                return "Could not connect to printer at " + address;
            }

            this.socket = s;
            this.inputStream = s.getInputStream();
            this.outputStream = s.getOutputStream();
            Log.i(TAG, "Successfully connected to " + address);
            return "OK";
        } catch (Exception e) {
            Log.e(TAG, "Error connecting to " + address, e);
            disconnect();
            return "Connection error: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public String writeBase64(String base64Data) {
        if (socket == null || outputStream == null || !socket.isConnected()) {
            return "Not connected to printer.";
        }
        try {
            byte[] bytes = Base64.decode(base64Data, Base64.NO_WRAP);
            outputStream.write(bytes);
            outputStream.flush();
            return "OK";
        } catch (Exception e) {
            Log.e(TAG, "Write error", e);
            return "Write failed: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public String readBase64(int byteCount, int timeoutMs) {
        if (socket == null || inputStream == null || !socket.isConnected()) {
            return "ERR:Not connected";
        }
        try {
            byte[] buffer = new byte[byteCount];
            int totalRead = 0;
            long deadline = System.currentTimeMillis() + timeoutMs;

            while (totalRead < byteCount) {
                if (System.currentTimeMillis() >= deadline) {
                    return "ERR:Timeout waiting for " + byteCount + " bytes (got " + totalRead + ")";
                }

                int available = inputStream.available();
                if (available > 0) {
                    int toRead = Math.min(available, byteCount - totalRead);
                    int read = inputStream.read(buffer, totalRead, toRead);
                    if (read < 0) {
                        return "ERR:Stream closed by remote printer";
                    }
                    totalRead += read;
                } else {
                    try {
                        Thread.sleep(10);
                    } catch (InterruptedException ignored) {
                        break;
                    }
                }
            }

            return Base64.encodeToString(buffer, Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "Read error", e);
            return "ERR:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public boolean isConnected() {
        return socket != null && socket.isConnected();
    }

    @JavascriptInterface
    public void disconnect() {
        try {
            if (inputStream != null) inputStream.close();
        } catch (Exception ignored) {}
        try {
            if (outputStream != null) outputStream.close();
        } catch (Exception ignored) {}
        try {
            if (socket != null) socket.close();
        } catch (Exception ignored) {}
        inputStream = null;
        outputStream = null;
        socket = null;
        Log.i(TAG, "Bluetooth RFCOMM disconnected.");
    }
}
