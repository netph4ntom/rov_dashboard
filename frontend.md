# ROV Control Station — Frontend Engineering Documentation

> **Versi**: v2.0 (dengan Autonomous Mission System)
> **Target pembaca**: Frontend Engineer yang membangun Control Station UI
> **Stack**: React / Vue / Svelte — bebas pilih framework

---

## Daftar Isi

1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Koneksi dan Setup](#2-koneksi-dan-setup)
3. [REST API Endpoints](#3-rest-api-endpoints)
4. [WebSocket Events — Inbound](#4-websocket-events--inbound-frontend--backend)
5. [WebSocket Events — Outbound](#5-websocket-events--outbound-backend--frontend)
6. [Video Streaming](#6-video-streaming)
7. [RC Channel Mapping dan Joystick](#7-rc-channel-mapping-dan-joystick-control)
8. [Autonomous Mission Flow](#8-autonomous-mission-flow)
9. [Failsafe dan Emergency](#9-failsafe-dan-emergency-handling)
10. [Layout UI yang Direkomendasikan](#10-layout-ui-yang-direkomendasikan)
11. [State Management](#11-state-management)

---

## 1. Arsitektur Sistem

Sistem berjalan di Raspberry Pi dengan **3 proses paralel**:

| Proses | Port | Deskripsi |
|--------|------|-----------|
| **Core API** | **8000** | REST + Socket.IO + MAVLink + Telemetry + Failsafe + Autonomous |
| **Camera Front** | **8001** | MJPEG/WebRTC stream + QR Detector (autonomous alignment) |
| **Camera Bottom** | **8002** | MJPEG/WebRTC stream + QR Detector (docking) |

**Base URL semua koneksi**: `http://<RASPBERRY_PI_IP>:<PORT>`

---

## 2. Koneksi dan Setup

### 2.1 Socket.IO Connection

```js
import { io } from "socket.io-client";

const socket = io("http://IP_ROV:8000", {
  transports: ["websocket", "polling"],
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

socket.on("connect", () => {
  // Backend otomatis emit 3 snapshot ke client baru:
  // - telemetry_update
  // - trajectory_update
  // - mavlink_status
  console.log("Connected!");
});
```

### 2.2 Dynamic IP Management

Simpan IP ke `localStorage` agar bisa dikonfigurasi saat pertama buka:

```js
const ip = localStorage.getItem("rov_ip") || "192.168.2.2";

const URLS = {
  api:          `http://${ip}:8000`,
  socket:       `http://${ip}:8000`,
  streamFront:  `http://${ip}:8001/stream`,
  streamBottom: `http://${ip}:8002/stream`,
  webrtcFront:  `http://${ip}:8001/offer`,
  webrtcBottom: `http://${ip}:8002/offer`,
};

// Test koneksi
async function testConnection(ip) {
  try {
    const r = await fetch(`http://${ip}:8000/api/health`, {
      signal: AbortSignal.timeout(3000)
    });
    return (await r.json()).status === "ok";
  } catch { return false; }
}
```

---

## 3. REST API Endpoints

**Base**: `http://IP:8000` | **CORS**: enabled untuk semua origin

---

### `GET /api/health`
Health check sederhana. Gunakan untuk test koneksi.
```json
{ "status": "ok" }
```

---

### `GET /api/status`
Status sistem dan MAVLink.
```json
{
  "service": "ROV Core API",
  "status": "running",
  "timestamp": "2024-01-15T10:30:00.123456",
  "mavlink": { "connected": true }
}
```

---

### `GET /api/streams`
URL semua stream dan health kamera.
```json
{
  "front":  { "stream_url": "http://IP:8001/stream", "webrtc_url": "http://IP:8001/offer", "health_url": "http://IP:8001/health" },
  "bottom": { "stream_url": "http://IP:8002/stream", "webrtc_url": "http://IP:8002/offer", "health_url": "http://IP:8002/health" }
}
```

---

### `GET /api/telemetry`
Snapshot telemetry (gunakan WebSocket `telemetry_update` untuk real-time).

```json
{
  "roll": -1.25,
  "pitch": 0.43,
  "yaw": 178.90,
  "depth": 1.234,
  "battery_voltage": 14.8,
  "battery_current": 2.35,
  "battery_remaining": 87,
  "lat": 0.0,
  "lon": 0.0,
  "gps_fix": 0,
  "armed": true,
  "mode": "MANUAL",
  "accel_x": 0.0012, "accel_y": -0.0034, "accel_z": 9.7812,
  "gyro_x": 0.0001,  "gyro_y": -0.0002,  "gyro_z": 0.0000,
  "last_update": 1705312200.123
}
```

**Mode ArduSub yang dikenal:**
`MANUAL` | `STABILIZE` | `DEPTH_HOLD` | `ACRO` | `GUIDED` | `AUTO` | `LOITER` | `POSHOLD`

---

### `GET /api/trajectory`
Posisi estimasi ROV dan trail perjalanan (dead reckoning, bukan GPS).

```json
{
  "current_pos": { "x": 1.234, "y": -0.567, "depth": 1.234 },
  "orientation": { "roll": -1.25, "pitch": 0.43, "yaw": 178.90 },
  "path": [
    { "x": 0.00, "y": 0.00, "depth": 0.0, "yaw": 0.0,  "timestamp": 1705312100.0 },
    { "x": 0.15, "y": 0.02, "depth": 0.5, "yaw": 5.3,  "timestamp": 1705312101.0 },
    { "x": 0.45, "y": 0.08, "depth": 1.0, "yaw": 10.1, "timestamp": 1705312102.0 }
  ],
  "timestamp": 1705312200.123
}
```

---

### `POST /api/trajectory/reset`
Reset posisi ke origin (0, 0, 0). Panggil saat ROV di posisi docking awal.

```json
{ "message": "Trajectory reset ke origin" }
```

---

### `POST /api/trajectory/set_target` — **[AUTONOMOUS]**
Simpan snapshot jalur rekaman sebagai waypoints replay autonomous.
Panggil setelah drive manual dari docking ke target.

**Request Body:**
```json
{ "target_id": "TARGET_A" }
```

**Response:**
```json
{
  "message": "Target 'TARGET_A' snapshot disimpan",
  "target_id": "TARGET_A",
  "waypoints": 47
}
```

> Pastikan `waypoints > 0` sebelum memulai misi autonomous.

---

### `GET /api/qr/history`
Riwayat QR Code terscan dari kamera bawah (max 50 terakhir).

```json
{
  "count": 3,
  "history": [
    { "data": "DOCKING_1", "aligned": true, "timestamp": 1705312100.0, "received_at": "2024-01-15T10:30:00.000000" }
  ]
}
```

---

### `DELETE /api/qr/history`
Hapus semua riwayat QR.

---

### `POST /api/camera/{cam}/screenshot`
Ambil screenshot. `{cam}` = `front` atau `bottom`.
Hasil dikirim via WebSocket event `camera_result`.

---

### `POST /api/camera/{cam}/record/start`
Mulai recording video kamera.

---

### `POST /api/camera/{cam}/record/stop`
Stop recording video kamera.

---

### `GET /api/failsafe/status`
Snapshot health seluruh subsistem.

```json
{
  "emergency_active": false,
  "emergency_reason": "",
  "subsystems": {
    "mavlink":       { "ok": true,  "severity": "INFO",    "message": "Heartbeat OK",         "recovery_attempts": 0, "fault_since": null },
    "dashboard":     { "ok": true,  "severity": "INFO",    "message": "Dashboard terhubung",  "recovery_attempts": 0, "fault_since": null },
    "telemetry":     { "ok": true,  "severity": "INFO",    "message": "Fresh",                "recovery_attempts": 0, "fault_since": null },
    "camera_front":  { "ok": true,  "severity": "INFO",    "message": "Kamera OK",            "recovery_attempts": 0, "fault_since": null },
    "camera_bottom": { "ok": false, "severity": "WARNING", "message": "Health check gagal",   "recovery_attempts": 2, "fault_since": 1705312100.0 },
    "system":        { "ok": true,  "severity": "INFO",    "message": "CPU 45% | RAM 62%",    "recovery_attempts": 0, "fault_since": null }
  },
  "event_count": 5,
  "timestamp": "2024-01-15T10:30:00.000000Z"
}
```

**Severity Levels:**

| Level | Warna UI | Tindakan Backend |
|-------|----------|-----------------|
| `INFO` | Hijau | Normal |
| `WARNING` | Kuning | Coba recovery otomatis |
| `CRITICAL` | Oranye | RC netral + mode MANUAL |
| `EMERGENCY` | Merah | DISARM + notif E-Stop |

---

### `GET /api/failsafe/events?limit=50`
Riwayat event failsafe, terbaru dulu.

```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "subsystem": "mavlink",
    "severity": "WARNING",
    "message": "Heartbeat timeout",
    "action": "reconnect_mavlink"
  }
]
```

---

### `GET /api/autonomous/status` — **[AUTONOMOUS]**
Status misi autonomous saat ini.

```json
{
  "state": "REPLAYING",
  "target_id": "TARGET_A",
  "elapsed_s": 12.5,
  "abort_reason": "",
  "is_active": true
}
```

**State values:** `IDLE` | `REPLAYING` | `ALIGNING` | `PICKUP` | `RETURNING` | `COMPLETE` | `ABORTING`

---

## 4. WebSocket Events — Inbound (Frontend → Backend)

### `cmd_arm`
```js
socket.emit("cmd_arm");
```

### `cmd_disarm`
```js
socket.emit("cmd_disarm");
```

### `cmd_set_mode`
```js
socket.emit("cmd_set_mode", { mode: "MANUAL" });
// mode: MANUAL | STABILIZE | DEPTH_HOLD | GUIDED | AUTO
```

### `cmd_gripper`
```js
socket.emit("cmd_gripper", { action: "open" });
socket.emit("cmd_gripper", { action: "close" });
```

### `cmd_light`
```js
socket.emit("cmd_light", { state: true });   // nyala
socket.emit("cmd_light", { state: false });  // mati
```

### `cmd_rc_override`
**Event utama untuk kontrol manual.** Kirim terus-menerus saat tombol ditekan (loop 50ms).

```js
socket.emit("cmd_rc_override", {
  channels: {
    "1": 1500,  // CH1: Lateral/Strafe  (1100=kiri, 1500=netral, 1900=kanan)
    "2": 1600,  // CH2: Forward/Backward (1100=mundur, 1900=maju)
    "3": 1500,  // CH3: Throttle/Vertical (1100=turun, 1900=naik)
    "4": 1500,  // CH4: Yaw             (1100=putar kiri, 1900=putar kanan)
  }
});

// Saat semua tombol dilepas, kirim netral:
socket.emit("cmd_rc_override", {
  channels: { "1": 1500, "2": 1500, "3": 1500, "4": 1500 }
});
```

### `cmd_emergency_stop`
```js
socket.emit("cmd_emergency_stop", { reason: "Operator E-Stop" });
// Efek: RC netral + DISARM + emit emergency_stop ke semua client
```

### `cmd_clear_emergency`
```js
socket.emit("cmd_clear_emergency");
// Dipanggil setelah operator konfirmasi aman
```

### `cmd_autonomous_start` — **[AUTONOMOUS]**
```js
socket.emit("cmd_autonomous_start", { target_id: "TARGET_A" });
// Pastikan sudah POST /api/trajectory/set_target sebelumnya!
```

### `cmd_autonomous_stop` — **[AUTONOMOUS]**
```js
socket.emit("cmd_autonomous_stop", { reason: "operator_abort" });
```

### `ping_rov`
```js
socket.emit("ping_rov", { ts: Date.now() });
// Backend balas dengan pong_rov
```

---

## 5. WebSocket Events — Outbound (Backend → Frontend)

### `telemetry_update`
Dikirim setiap ada update sensor dari Pixhawk (~10-20Hz).
Payload identik dengan `GET /api/telemetry`.

```js
socket.on("telemetry_update", (data) => {
  updateDepth(data.depth);
  updateAttitude(data.roll, data.pitch, data.yaw);
  updateBattery(data.battery_voltage, data.battery_remaining);
  updateStatus(data.armed, data.mode);
});
```

---

### `trajectory_update`
Update posisi estimasi dan trail (~1-5Hz). Payload identik dengan `GET /api/trajectory`.

```js
socket.on("trajectory_update", (data) => {
  drawTrail(data.path);
  updateRovMarker(data.current_pos);
});
```

---

### `mavlink_status`
```js
socket.on("mavlink_status", (data) => {
  // { connected: boolean }
  setMavlinkIndicator(data.connected);
});
```

---

### `qr_detected`
QR Code terscan oleh kamera bawah.

```js
socket.on("qr_detected", (data) => {
  // { data: string, aligned: boolean, timestamp: float, source: "bottom" }
  addQRToHistory(data);
});
```

---

### `dock_aligned`
ROV sejajar dengan docking target.

```js
socket.on("dock_aligned", (data) => {
  showAlert("DOCKING ALIGNED", "success");
});
```

---

### `dock_lost`
Docking alignment hilang.

```js
socket.on("dock_lost", (data) => {
  showAlert("DOCKING LOST", "warning");
});
```

---

### `camera_result`
Screenshot atau recording selesai.

```js
socket.on("camera_result", (data) => {
  // { camera: "front"|"bottom", action: "screenshot"|"record_start"|"record_stop",
  //   status: "ok"|"error", filepath: string, filename: string }
  if (data.action === "screenshot" && data.status === "ok")
    showNotif("Screenshot: " + data.filename);
  if (data.action === "record_stop" && data.status === "ok")
    showNotif("Video: " + data.filename);
});
```

---

### `failsafe_status`
Health snapshot seluruh subsistem. Dikirim periodik tiap ~2 detik.
Payload identik dengan `GET /api/failsafe/status`.

```js
socket.on("failsafe_status", (data) => {
  updateHealthBadges(data.subsystems);
  if (data.emergency_active) showEmergencyBanner(data.emergency_reason);
});
```

---

### `failsafe_event`
Event anomali / recovery / eskalasi.

```js
socket.on("failsafe_event", (data) => {
  // { timestamp, subsystem, severity, message, action }
  appendEventLog(data);
});
```

---

### `emergency_stop`
**Emergency Stop aktif.** Tampilkan overlay penuh dan nonaktifkan semua kontrol.

```js
socket.on("emergency_stop", (data) => {
  // { timestamp, severity: "EMERGENCY", message, action: "rc_neutral + disarm",
  //   requires_operator_clearance: true }
  showFullscreenEmergency(data.message);
  disableAllControls();
  stopJoystickLoop();
});
```

> **Wajib**: Saat event ini diterima, semua input kontrol harus di-disable hingga operator klik "CLEAR EMERGENCY" yang memanggil `cmd_clear_emergency`.

---

### `autonomous_status` — **[AUTONOMOUS]**
Progress misi autonomous. Dikirim setiap state transition dan update progress.

```js
socket.on("autonomous_status", (data) => {
  // Base fields:
  //   state: "IDLE"|"REPLAYING"|"ALIGNING"|"PICKUP"|"RETURNING"|"COMPLETE"|"ABORTING"
  //   target_id: string
  //   elapsed_s: number
  //   is_active: boolean
  //
  // Extra saat REPLAYING/RETURNING:
  //   waypoint_index: number
  //   waypoint_total: number
  //
  // Extra saat ALIGNING:
  //   qr_offset_x: number  (piksel dari center frame, + = kanan)
  //   qr_offset_y: number  (piksel dari center frame, + = bawah)

  updateMissionState(data.state);
  if (data.waypoint_total)
    updateProgress(data.waypoint_index / data.waypoint_total * 100);
  if (data.qr_offset_x !== undefined)
    updateAlignmentHUD(data.qr_offset_x, data.qr_offset_y);
});
```

---

### `mission_event` — **[AUTONOMOUS]**
Milestone penting dalam misi untuk ditampilkan di log panel.

```js
socket.on("mission_event", (data) => {
  // { type: string, message: string, timestamp: string }
  addMissionLog(data.message, data.type);
});
```

**Nilai `type`:**

| type | Fase | Deskripsi |
|------|------|-----------|
| `mission_started` | Awal | Misi dimulai |
| `qr_searching` | ALIGNING | Mencari QR Code |
| `qr_aligned` | ALIGNING | Posisi sejajar dengan QR |
| `align_timeout` | ALIGNING | Timeout QR alignment |
| `pickup_start` | PICKUP | Membuka gripper |
| `pickup_advance` | PICKUP | Maju memasukkan objek |
| `pickup_close` | PICKUP | Menutup gripper |
| `pickup_done` | PICKUP | Objek berhasil diambil |

---

### `mission_complete` — **[AUTONOMOUS]**
Misi selesai (berhasil atau gagal/dibatalkan).

```js
socket.on("mission_complete", (data) => {
  // { success: boolean, target_id: string, duration_s: number, reason: string, timestamp: string }
  if (data.success)
    showSuccess(`Misi selesai dalam ${data.duration_s}s`);
  else
    showError(`Misi gagal: ${data.reason}`);
  enableAllControls();  // penting: re-enable joystick
});
```

---

### `pong_rov`
Respons ping untuk ukur latency.

```js
socket.on("pong_rov", (data) => {
  const latency = Date.now() - data.echo.ts;
  displayLatency(latency + "ms");
});
```

---

## 6. Video Streaming

### 6.1 MJPEG (Direkomendasikan untuk Simplicity)

```html
<!-- Langsung embed sebagai img tag -->
<img id="cam-front"  src="http://IP:8001/stream" alt="Kamera Depan" />
<img id="cam-bottom" src="http://IP:8002/stream" alt="Kamera Bawah" />
```

Auto-retry jika koneksi putus:
```js
const img = document.getElementById("cam-front");
img.onerror = () => {
  setTimeout(() => {
    img.src = `http://IP:8001/stream?t=${Date.now()}`;
  }, 3000);
};
```

### 6.2 WebRTC (Ultra Low-Latency, < 100ms)

```js
async function startWebRTC(ip, port, videoEl) {
  const pc = new RTCPeerConnection();
  pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; };
  pc.addTransceiver("video", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const res = await fetch(`http://${ip}:${port}/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
  });
  const answer = await res.json();
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

// Penggunaan:
startWebRTC("192.168.1.100", 8001, document.getElementById("video-front"));
startWebRTC("192.168.1.100", 8002, document.getElementById("video-bottom"));
```

```html
<video id="video-front"  autoplay playsinline muted></video>
<video id="video-bottom" autoplay playsinline muted></video>
```

---

## 7. RC Channel Mapping dan Joystick Control

### Mapping ArduSub Standard

| Channel | Fungsi | Netral | Maks (+) | Min (-) |
|---------|--------|--------|----------|---------|
| **CH1** | Lateral / Strafe | 1500 | 1900 (kanan) | 1100 (kiri) |
| **CH2** | Forward / Backward | 1500 | 1900 (maju) | 1100 (mundur) |
| **CH3** | Throttle / Vertical | 1500 | 1900 (naik) | 1100 (turun) |
| **CH4** | Yaw | 1500 | 1900 (putar kanan) | 1100 (putar kiri) |

### Konversi Axis Gamepad ke PWM

```js
const DEADZONE  = 0.07;
const PWM_RANGE = 400;

function axisToPWM(axisValue) {
  if (Math.abs(axisValue) < DEADZONE) return 1500;
  return Math.round(1500 + axisValue * PWM_RANGE);
}
```

### Implementasi Gamepad Loop

```js
let joystickInterval = null;

function startJoystick() {
  joystickInterval = setInterval(() => {
    const gp = navigator.getGamepads()[0];
    if (!gp) return;

    // Mapping standar Gamepad API:
    // axes[0] = Left Stick X  → CH1 Lateral
    // axes[1] = Left Stick Y  → CH2 Forward  (INVERTED)
    // axes[2] = Right Stick X → CH4 Yaw
    // axes[3] = Right Stick Y → CH3 Throttle (INVERTED)
    socket.emit("cmd_rc_override", {
      channels: {
        "1": axisToPWM(gp.axes[0]),    // Lateral
        "2": axisToPWM(-gp.axes[1]),   // Forward (inverted)
        "3": axisToPWM(-gp.axes[3]),   // Throttle (inverted)
        "4": axisToPWM(gp.axes[2]),    // Yaw
      }
    });
  }, 50);  // 20Hz
}

function stopJoystick() {
  clearInterval(joystickInterval);
  // Kirim netral
  socket.emit("cmd_rc_override", {
    channels: { "1": 1500, "2": 1500, "3": 1500, "4": 1500 }
  });
}

window.addEventListener("gamepadconnected",    () => startJoystick());
window.addEventListener("gamepaddisconnected", () => stopJoystick());
```

---

## 8. Autonomous Mission Flow

### Langkah Operator (Step-by-Step)

```
STEP 1: Reset posisi ROV di titik docking
        → POST /api/trajectory/reset

STEP 2: Drive ROV manual dari Docking ke Target
        → Gunakan joystick (cmd_rc_override)
        → Trajectory direkam otomatis oleh backend

STEP 3: Saat ROV sudah dekat target, klik "Set Target"
        → POST /api/trajectory/set_target { "target_id": "TARGET_A" }
        → Pastikan response waypoints > 0

STEP 4: Klik "Start Autonomous"
        → socket.emit("cmd_autonomous_start", { target_id: "TARGET_A" })
        → NONAKTIFKAN joystick dan semua tombol kontrol!

STEP 5: Monitor di Mission Panel:
        - autonomous_status → state dan progress
        - mission_event     → log milestone
        - Feed kamera depan → QR alignment overlay otomatis muncul saat ALIGNING

STEP 6: Misi selesai (mission_complete diterima)
        → Re-enable kontrol manual
```

### State Machine Visual

```
IDLE ──start──► REPLAYING ──selesai──► ALIGNING ──aligned──► PICKUP ──selesai──► RETURNING ──selesai──► COMPLETE
  ▲                │                      │                                           │
  │           abort/E-Stop           timeout/abort                              abort/E-Stop
  └────────────────┴──────────────────────┴───────────────────────────────────────────┘
                                      ABORTING ──────────────────────────────────────► IDLE
```

### Deskripsi Setiap Fase

| State | Aksi Backend | Yang Ditampilkan di UI |
|-------|-------------|----------------------|
| `REPLAYING` | Replay trajectory menuju target | Progress bar waypoint, posisi di map |
| `ALIGNING` | QR detection + fine-alignment | QR overlay di kamera depan, offset XY |
| `PICKUP` | Open gripper → maju → close gripper | Animasi gripper sequence |
| `RETURNING` | Replay trajectory terbalik | Progress bar waypoint mundur |
| `COMPLETE` | Set MANUAL mode | Dialog sukses, enable kontrol |
| `ABORTING` | RC netral, set MANUAL | Dialog gagal + alasan |

### QR Alignment HUD

Saat state `ALIGNING`, tampilkan alignment indicator di atas feed kamera depan:

```js
socket.on("autonomous_status", (data) => {
  if (data.state === "ALIGNING" && data.qr_offset_x !== undefined) {
    const THRESHOLD = 30; // piksel
    const isAligned = Math.abs(data.qr_offset_x) < THRESHOLD
                   && Math.abs(data.qr_offset_y) < THRESHOLD;

    // Gambar crosshair + indikator posisi QR
    drawAlignmentIndicator(data.qr_offset_x, data.qr_offset_y, isAligned);
  }
});
```

---

## 9. Failsafe dan Emergency Handling

### Pola UI Emergency

```js
let emergencyActive = false;

socket.on("emergency_stop", (data) => {
  emergencyActive = true;
  stopJoystick();
  disableAllControls();

  // Tampilkan overlay MERAH penuh
  document.getElementById("emergency-overlay").style.display = "flex";
  document.getElementById("emergency-message").textContent = data.message;
});

socket.on("failsafe_status", (data) => {
  if (!data.emergency_active && emergencyActive) {
    emergencyActive = false;
    document.getElementById("emergency-overlay").style.display = "none";
    enableAllControls();
  }
});

// Tombol "CLEAR EMERGENCY" di overlay
document.getElementById("btn-clear-emergency").onclick = () => {
  socket.emit("cmd_clear_emergency");
};
```

### Health Badges Subsistem

Tampilkan 6 badge dari `failsafe_status.subsystems`:

| Key | Label | Monitor |
|-----|-------|---------|
| `mavlink` | MAVLink | Koneksi ke Pixhawk |
| `telemetry` | Telemetry | Data sensor fresh |
| `camera_front` | Cam Depan | Kamera depan OK |
| `camera_bottom` | Cam Bawah | Kamera bawah OK |
| `dashboard` | Dashboard | Koneksi WebSocket |
| `system` | System | CPU/RAM/Suhu Pi |

```js
socket.on("failsafe_status", (data) => {
  Object.entries(data.subsystems).forEach(([key, health]) => {
    setBadge(key, health.severity, health.message);
    // severity: "INFO"=hijau | "WARNING"=kuning | "CRITICAL"=oranye | "EMERGENCY"=merah
  });
});
```

---

## 10. Layout UI yang Direkomendasikan

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER: [IP Config] [MAVLink●] [Batt 87%] [Health Badges x6]   │
├──────────────────────┬──────────────────────┬───────────────────┤
│  Kamera Depan        │  Kamera Bawah        │  Telemetry Panel  │
│  MJPEG/WebRTC        │  MJPEG/WebRTC        │  ─────────────    │
│  640×480             │  640×480             │  Depth:   1.2m    │
│  [QR HUD overlay]    │  [Dock Align Badge]  │  Roll:   -1.2°    │
│                      │                      │  Pitch:   0.4°    │
│                      │                      │  Yaw:   178.9°    │
│                      │                      │  Mode: MANUAL     │
│                      │                      │  ARM: ARMED ●     │
├──────────────────────┴──────────────────────┤  Battery: ████░   │
│  Trajectory Map (Top-Down 2D)               │  14.8V 87%        │
│  ● current pos                              ├───────────────────┤
│  — trail polyline                           │  Autonomous Panel │
│  ◆ origin / docking                         │  State: REPLAYING │
│  ✕ target marker                            │  Target: TARGET_A │
│                                             │  ████████░░ 78%   │
│  [Reset Pos] [Set Target: TARGET_A ▼]       │  Elapsed: 12.5s   │
│                                             │  ─────────────    │
│                                             │  Mission Log:     │
│                                             │  10:30 qr_aligned │
│                                             │  10:29 qr_search  │
│                                             │  [Start] [Stop]   │
├─────────────────────────────────────────────┴───────────────────┤
│ CONTROLS: [ARM] [DISARM] [MODE:MANUAL▼] [LIGHT●] [GRIPPER O/C] │
│           [📷 Front] [📷 Bottom] [⏺ Rec F] [⏺ Rec B]          │
│                    [🔴 EMERGENCY STOP]                          │
├─────────────────────────────────────────────────────────────────┤
│ FAILSAFE: MAVLink:OK | Telemetry:OK | CamF:OK | CamB:WARN | ... │
│ EVENT LOG (scrollable): [10:30] mavlink kembali normal ...      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. State Management

### Struktur State Global yang Direkomendasikan

```js
// Zustand / Pinia / Redux / Context — sesuai framework

const rovState = {
  // Connection
  connected:       false,
  mavlinkConnected: false,
  latencyMs:       0,

  // Telemetry (dari telemetry_update)
  telemetry: {
    roll: 0, pitch: 0, yaw: 0,
    depth: 0,
    battery_voltage: 0, battery_remaining: 100,
    armed: false, mode: "UNKNOWN",
    last_update: null,
  },

  // Trajectory (dari trajectory_update)
  trajectory: {
    current_pos: { x: 0, y: 0, depth: 0 },
    path:        [],
    orientation: { roll: 0, pitch: 0, yaw: 0 },
  },

  // Failsafe (dari failsafe_status + emergency_stop)
  failsafe: {
    emergency_active: false,
    emergency_reason: "",
    subsystems: {
      mavlink:       { ok: true, severity: "INFO", message: "" },
      telemetry:     { ok: true, severity: "INFO", message: "" },
      camera_front:  { ok: true, severity: "INFO", message: "" },
      camera_bottom: { ok: true, severity: "INFO", message: "" },
      dashboard:     { ok: true, severity: "INFO", message: "" },
      system:        { ok: true, severity: "INFO", message: "" },
    },
    events: [],  // dari failsafe_event
  },

  // Autonomous (dari autonomous_status + mission_event + mission_complete)
  autonomous: {
    state:           "IDLE",
    target_id:       "",
    elapsed_s:       0,
    is_active:       false,
    waypoint_index:  0,
    waypoint_total:  0,
    qr_offset_x:     0,
    qr_offset_y:     0,
    mission_log:     [],  // array dari mission_event
  },

  // Camera (dari camera_result)
  camera: {
    front:  { recording: false, last_screenshot: null },
    bottom: { recording: false, last_screenshot: null },
  },

  // QR (dari qr_detected)
  qr_history: [],
};
```

---

## Referensi Cepat

### Semua WebSocket Events

| Arah | Event | Deskripsi |
|------|-------|-----------|
| → | `cmd_arm` | ARM ROV |
| → | `cmd_disarm` | DISARM ROV |
| → | `cmd_set_mode` | Ganti mode `{ mode }` |
| → | `cmd_gripper` | `{ action: "open"\|"close" }` |
| → | `cmd_light` | `{ state: boolean }` |
| → | `cmd_rc_override` | `{ channels: { "1"..:"4": PWM } }` |
| → | `cmd_emergency_stop` | `{ reason }` |
| → | `cmd_clear_emergency` | — |
| → | `cmd_autonomous_start` | `{ target_id }` |
| → | `cmd_autonomous_stop` | `{ reason }` |
| → | `ping_rov` | `{ ts: Date.now() }` |
| ← | `telemetry_update` | Data sensor real-time |
| ← | `trajectory_update` | Posisi dan trail |
| ← | `mavlink_status` | `{ connected }` |
| ← | `qr_detected` | `{ data, aligned, timestamp, source }` |
| ← | `dock_aligned` | `{ aligned, timestamp }` |
| ← | `dock_lost` | `{ aligned, timestamp }` |
| ← | `camera_result` | `{ camera, action, status, filepath, filename }` |
| ← | `failsafe_status` | Health seluruh subsistem |
| ← | `failsafe_event` | `{ timestamp, subsystem, severity, message, action }` |
| ← | `emergency_stop` | `{ message, requires_operator_clearance }` |
| ← | `autonomous_status` | `{ state, target_id, elapsed_s, is_active, ... }` |
| ← | `mission_event` | `{ type, message, timestamp }` |
| ← | `mission_complete` | `{ success, target_id, duration_s, reason }` |
| ← | `pong_rov` | `{ echo }` |

### Semua REST Endpoints

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/health` | Health check |
| GET | `/api/status` | Status sistem + MAVLink |
| GET | `/api/streams` | URL stream kamera |
| GET | `/api/telemetry` | Snapshot telemetry |
| GET | `/api/trajectory` | Posisi estimasi + trail |
| POST | `/api/trajectory/reset` | Reset posisi ke origin |
| POST | `/api/trajectory/set_target` | Simpan waypoints autonomous |
| GET | `/api/qr/history` | Riwayat QR scan (max 50) |
| DELETE | `/api/qr/history` | Hapus riwayat QR |
| POST | `/api/camera/front/screenshot` | Screenshot kamera depan |
| POST | `/api/camera/bottom/screenshot` | Screenshot kamera bawah |
| POST | `/api/camera/front/record/start` | Mulai recording depan |
| POST | `/api/camera/front/record/stop` | Stop recording depan |
| POST | `/api/camera/bottom/record/start` | Mulai recording bawah |
| POST | `/api/camera/bottom/record/stop` | Stop recording bawah |
| GET | `/api/failsafe/status` | Health seluruh subsistem |
| GET | `/api/failsafe/events?limit=N` | Riwayat event failsafe |
| GET | `/api/autonomous/status` | Status misi autonomous |
