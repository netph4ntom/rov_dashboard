import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Anchor,
  Activity,
  Compass,
  Battery,
  ShieldAlert,
  Terminal,
  Settings,
  Lightbulb,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  FolderHeart,
  ChevronRight,
  HelpCircle,
  Camera,
  Layers,
  Cpu
} from "lucide-react";
import "./App.css";

// Import custom components and simulation engine
import CameraFeed from "./CameraFeed";
import TrajectoryMap from "./TrajectoryMap";
import { RovSimulator } from "./Simulator";

export default function App() {
  // IP Config
  const [rovIp, setRovIp] = useState(() => localStorage.getItem("rov_ip") || "192.168.2.2");
  const [ipInput, setIpInput] = useState(rovIp);
  const [isEditingIp, setIsEditingIp] = useState(false);

  // Connection & Modes States
  const [socketConnected, setSocketConnected] = useState(false);
  const [mavlinkConnected, setMavlinkConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const [simulationMode, setSimulationMode] = useState(true); // Default to True for offline testing

  // Telemetry States
  const [telemetry, setTelemetry] = useState({
    roll: 0,
    pitch: 0,
    yaw: 0,
    depth: 0,
    battery_voltage: 14.8,
    battery_current: 0.0,
    battery_remaining: 100,
    armed: false,
    mode: "MANUAL",
    last_update: null
  });

  // Trajectory States
  const [trajectory, setTrajectory] = useState({
    current_pos: { x: 0, y: 0, depth: 0 },
    path: [],
    orientation: { roll: 0, pitch: 0, yaw: 0 }
  });

  // Failsafe & Event Logs
  const [failsafe, setFailsafe] = useState({
    emergency_active: false,
    emergency_reason: "",
    subsystems: {
      mavlink:       { ok: true, severity: "INFO", message: "Normal" },
      telemetry:     { ok: true, severity: "INFO", message: "Normal" },
      camera_front:  { ok: true, severity: "INFO", message: "Normal" },
      camera_bottom: { ok: true, severity: "INFO", message: "Normal" },
      dashboard:     { ok: true, severity: "INFO", message: "Normal" },
      system:        { ok: true, severity: "INFO", message: "Normal" }
    }
  });

  const [failsafeEvents, setFailsafeEvents] = useState([
    { timestamp: new Date().toISOString(), subsystem: "dashboard", severity: "INFO", message: "Dashboard UI initialized", action: "none" }
  ]);

  // Autonomous State
  const [autonomous, setAutonomous] = useState({
    state: "IDLE",
    target_id: "",
    elapsed_s: 0,
    is_active: false,
    waypoint_index: 0,
    waypoint_total: 0,
    qr_offset_x: undefined,
    qr_offset_y: undefined,
    mission_log: []
  });

  // Camera recording states
  const [recordings, setRecordings] = useState({
    front: false,
    bottom: false
  });

  // Target selection & logs
  const [activeTarget, setActiveTarget] = useState("");
  const [qrHistory, setQrHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Refs for socket, simulator, and key loops
  const socketRef = useRef(null);
  const simulatorRef = useRef(null);
  const keyboardLoopRef = useRef(null);
  const gamepadLoopRef = useRef(null);

  // Track active keys for keyboard driving
  const keysPressed = useRef({});

  // Helper to add custom UI notifications
  const triggerNotification = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  // Standard conversions
  const axisToPWM = (axisValue) => {
    const DEADZONE = 0.08;
    const PWM_RANGE = 400;
    if (Math.abs(axisValue) < DEADZONE) return 1500;
    return Math.round(1500 + axisValue * PWM_RANGE);
  };

  // Event dispatcher (Unified socket/sim emission target)
  const dispatchCommand = useCallback((event, payload = {}) => {
    if (simulationMode) {
      if (simulatorRef.current) {
        simulatorRef.current.receiveCommand(event, payload);
      }
    } else {
      if (socketRef.current && socketConnected) {
        socketRef.current.emit(event, payload);
      } else {
        triggerNotification("Gagal mengirim komando: Koneksi Core API terputus", "error");
      }
    }
  }, [simulationMode, socketConnected, triggerNotification]);

  // Callback from Simulator
  const handleSimulatorEvent = useCallback((event, data) => {
    switch (event) {
      case "connect":
        setSocketConnected(true);
        break;
      case "telemetry_update":
        setTelemetry(prev => ({ ...prev, ...data }));
        break;
      case "trajectory_update":
        setTrajectory(data);
        break;
      case "mavlink_status":
        setMavlinkConnected(data.connected);
        break;
      case "failsafe_status":
        setFailsafe(data);
        break;
      case "failsafe_event":
        setFailsafeEvents(prev => [data, ...prev].slice(0, 50));
        break;
      case "emergency_stop":
        setFailsafe(prev => ({
          ...prev,
          emergency_active: true,
          emergency_reason: data.message
        }));
        triggerNotification(`EMERGENCY: ${data.message}`, "error");
        break;
      case "autonomous_status":
        setAutonomous(prev => ({
          ...prev,
          state: data.state,
          target_id: data.target_id,
          elapsed_s: data.elapsed_s,
          is_active: data.is_active,
          waypoint_index: data.waypoint_index,
          waypoint_total: data.waypoint_total,
          qr_offset_x: data.qr_offset_x,
          qr_offset_y: data.qr_offset_y
        }));
        break;
      case "mission_event":
        setAutonomous(prev => ({
          ...prev,
          mission_log: [{ timestamp: data.timestamp || new Date().toISOString(), type: data.type, message: data.message }, ...prev.mission_log].slice(0, 50)
        }));
        break;
      case "mission_complete":
        if (data.success) {
          triggerNotification(`Misi ${data.target_id} Selesai dalam ${data.duration_s}s!`, "success");
        } else {
          triggerNotification(`Misi Gagal: ${data.reason}`, "error");
        }
        break;
      case "qr_detected":
        setQrHistory(prev => [data, ...prev].slice(0, 50));
        break;
      case "dock_aligned":
        triggerNotification("DOCK ALIGNED SUCCESS", "success");
        break;
      case "pong_rov":
        setLatency(Date.now() - data.echo.ts);
        break;
      default:
        break;
    }
  }, [triggerNotification]);

  // Set up connection (Socket.io or Simulator)
  useEffect(() => {
    if (simulationMode) {
      // Disconnect socket if open
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      setMavlinkConnected(false);

      // Instanciate Simulator
      const sim = new RovSimulator(handleSimulatorEvent);
      simulatorRef.current = sim;
      sim.start();
      triggerNotification("Simulator Mode Aktif. Keyboard/Joystick control diaktifkan.", "warning");

      // Ping Interval for Simulator
      const pingInterval = setInterval(() => {
        sim.receiveCommand("ping_rov", { ts: Date.now() });
      }, 2000);

      return () => {
        clearInterval(pingInterval);
        sim.stop();
        simulatorRef.current = null;
      };
    } else {
      // Real Network Connection
      const socketUrl = `http://${rovIp}:8000`;
      triggerNotification(`Menghubungkan ke Core API: ${socketUrl}`, "info");

      const socket = io(socketUrl, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 5000
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        setSocketConnected(true);
        triggerNotification("Terhubung ke ROV Core API!", "success");
      });

      socket.on("disconnect", () => {
        setSocketConnected(false);
        setMavlinkConnected(false);
        triggerNotification("Koneksi Core API terputus", "error");
      });

      socket.on("connect_error", () => {
        triggerNotification("Gagal menghubungi ROV Core API", "error");
      });

      // Bind Socket Events
      socket.on("telemetry_update", (data) => setTelemetry(prev => ({ ...prev, ...data })));
      socket.on("trajectory_update", (data) => setTrajectory(data));
      socket.on("mavlink_status", (data) => setMavlinkConnected(data.connected));
      socket.on("failsafe_status", (data) => setFailsafe(data));
      socket.on("failsafe_event", (data) => setFailsafeEvents(prev => [data, ...prev].slice(0, 50)));
      socket.on("emergency_stop", (data) => {
        setFailsafe(prev => ({ ...prev, emergency_active: true, emergency_reason: data.message }));
        triggerNotification(`EMERGENCY: ${data.message}`, "error");
      });
      socket.on("qr_detected", (data) => setQrHistory(prev => [data, ...prev].slice(0, 50)));
      
      socket.on("autonomous_status", (data) => {
        setAutonomous(prev => ({
          ...prev,
          state: data.state,
          target_id: data.target_id,
          elapsed_s: data.elapsed_s,
          is_active: data.is_active,
          waypoint_index: data.waypoint_index,
          waypoint_total: data.waypoint_total,
          qr_offset_x: data.qr_offset_x,
          qr_offset_y: data.qr_offset_y
        }));
      });

      socket.on("mission_event", (data) => {
        setAutonomous(prev => ({
          ...prev,
          mission_log: [{ timestamp: data.timestamp || new Date().toISOString(), type: data.type, message: data.message }, ...prev.mission_log].slice(0, 50)
        }));
      });

      socket.on("mission_complete", (data) => {
        if (data.success) {
          triggerNotification(`Misi Selesai untuk Target ${data.target_id}`, "success");
        } else {
          triggerNotification(`Misi Gagal: ${data.reason}`, "error");
        }
      });

      socket.on("camera_result", (data) => {
        triggerNotification(`Kamera ${data.camera} - ${data.action} : ${data.status.toUpperCase()}`, data.status === "ok" ? "success" : "error");
        if (data.status === "ok" && data.action === "screenshot") {
          triggerNotification(`Tersimpan: ${data.filename}`, "info");
        }
      });

      socket.on("pong_rov", (data) => {
        setLatency(Date.now() - data.echo.ts);
      });

      // Ping Interval to measure network latency
      const pingInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit("ping_rov", { ts: Date.now() });
        }
      }, 2000);

      return () => {
        clearInterval(pingInterval);
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [simulationMode, rovIp, handleSimulatorEvent, triggerNotification]);

  // Handle IP Configuration Updates
  const handleSaveIp = () => {
    localStorage.setItem("rov_ip", ipInput);
    setRovIp(ipInput);
    setIsEditingIp(false);
    triggerNotification(`IP diubah menjadi ${ipInput}. Menyambung ulang...`, "info");
  };

  // Keyboard Flight Commands Event polling (50ms loop)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Avoid intercepting inputs on config textfields
      if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT") return;
      keysPressed.current[e.code] = true;
    };

    const handleKeyUp = (e) => {
      keysPressed.current[e.code] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Keyboard poll loop
    keyboardLoopRef.current = setInterval(() => {
      // Locked states
      if (!telemetry.armed || autonomous.is_active || failsafe.emergency_active) return;

      const keys = keysPressed.current;
      let ch1 = 1500; // Lateral: A/D
      let ch2 = 1500; // Forward: W/S or ArrowUp/ArrowDown
      let ch3 = 1500; // Vertical: Space/Shift
      let ch4 = 1500; // Yaw: Q/E or ArrowLeft/ArrowRight

      // CH1 Lateral
      if (keys["KeyA"]) ch1 = 1100;
      if (keys["KeyD"]) ch1 = 1900;

      // CH2 Forward/Backward
      if (keys["KeyW"] || keys["ArrowUp"]) ch2 = 1900;
      if (keys["KeyS"] || keys["ArrowDown"]) ch2 = 1100;

      // CH3 Vertical Throttle
      if (keys["Space"]) ch3 = 1900;
      if (keys["ShiftLeft"] || keys["ControlLeft"]) ch3 = 1100;

      // CH4 Yaw turning
      if (keys["KeyQ"] || keys["ArrowLeft"]) ch4 = 1100;
      if (keys["KeyE"] || keys["ArrowRight"]) ch4 = 1900;

      const activeMovement = ch1 !== 1500 || ch2 !== 1500 || ch3 !== 1500 || ch4 !== 1500;

      if (activeMovement) {
        dispatchCommand("cmd_rc_override", {
          channels: { "1": ch1, "2": ch2, "3": ch3, "4": ch4 }
        });
      } else {
        // Send neutral overrides to stabilize when keys released
        dispatchCommand("cmd_rc_override", {
          channels: { "1": 1500, "2": 1500, "3": 1500, "4": 1500 }
        });
      }
    }, 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      clearInterval(keyboardLoopRef.current);
    };
  }, [telemetry.armed, autonomous.is_active, failsafe.emergency_active, dispatchCommand]);

  // Gamepad Polling Hook
  useEffect(() => {
    let joystickInterval = null;

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];
      if (!gp) return;

      // Check dashboard locks
      if (!telemetry.armed || autonomous.is_active || failsafe.emergency_active) return;

      // axes[0] = Left Stick X  -> CH1 Lateral
      // axes[1] = Left Stick Y  -> CH2 Forward (INVERTED)
      // axes[2] = Right Stick X -> CH4 Yaw
      // axes[3] = Right Stick Y -> CH3 Throttle (INVERTED)
      dispatchCommand("cmd_rc_override", {
        channels: {
          "1": axisToPWM(gp.axes[0]),
          "2": axisToPWM(-gp.axes[1]),
          "3": axisToPWM(-gp.axes[3]),
          "4": axisToPWM(gp.axes[2])
        }
      });
    };

    const handleConnected = () => {
      triggerNotification("Gamepad/Joystick terdeteksi dan terhubung!", "success");
      joystickInterval = setInterval(pollGamepad, 50);
    };

    const handleDisconnected = () => {
      triggerNotification("Gamepad/Joystick diputuskan", "warning");
      clearInterval(joystickInterval);
      dispatchCommand("cmd_rc_override", {
        channels: { "1": 1500, "2": 1500, "3": 1500, "4": 1500 }
      });
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      clearInterval(joystickInterval);
    };
  }, [telemetry.armed, autonomous.is_active, failsafe.emergency_active, dispatchCommand, triggerNotification]);

  // Action Button Handlers
  const handleArmDisarm = () => {
    if (telemetry.armed) {
      dispatchCommand("cmd_disarm");
      triggerNotification("Mengirim komando: DISARM ROV", "info");
    } else {
      dispatchCommand("cmd_arm");
      triggerNotification("Mengirim komando: ARM ROV", "info");
    }
  };

  const handleSetMode = (mode) => {
    dispatchCommand("cmd_set_mode", { mode });
    triggerNotification(`Mengubah flight mode ke ${mode}`, "info");
  };

  const handleGripper = (action) => {
    dispatchCommand("cmd_gripper", { action });
    triggerNotification(`Mengirim Gripper: ${action.toUpperCase()}`, "info");
  };

  const handleLightToggle = () => {
    const newState = !telemetry.light_state;
    // Store light state locally inside telemetry block for simple visual state rendering
    setTelemetry(prev => ({ ...prev, light_state: newState }));
    dispatchCommand("cmd_light", { state: newState });
    triggerNotification(`Komando: Lampu ${newState ? "NYALA" : "MATI"}`, "info");
  };

  const handleEmergencyStop = () => {
    dispatchCommand("cmd_emergency_stop", { reason: "Operator Emergency Stop" });
  };

  const handleClearEmergency = () => {
    dispatchCommand("cmd_clear_emergency");
  };

  const handleStartAutonomous = () => {
    if (!activeTarget) {
      triggerNotification("Pilih target waypoint terlebih dahulu sebelum autonomous!", "error");
      return;
    }
    dispatchCommand("cmd_autonomous_start", { target_id: activeTarget });
    triggerNotification(`Memulai Misi Autonomous untuk ${activeTarget}`, "success");
  };

  const handleStopAutonomous = () => {
    dispatchCommand("cmd_autonomous_stop", { reason: "Operator Abort" });
    triggerNotification("Misi Autonomous dihentikan oleh operator", "warning");
  };

  const handleResetPos = () => {
    if (simulationMode && simulatorRef.current) {
      simulatorRef.current.resetTrajectory();
      setTrajectory(simulatorRef.current.trajectory);
    } else {
      // POST REST API call for reset
      fetch(`http://${rovIp}:8000/api/trajectory/reset`, { method: "POST" })
        .then(res => res.json())
        .then(data => triggerNotification(data.message || "Trajectory reset", "success"))
        .catch(() => triggerNotification("Gagal menghubungi REST API reset", "error"));
    }
  };

  const handleSetTrajectoryTarget = (targetId) => {
    setActiveTarget(targetId);
    if (simulationMode && simulatorRef.current) {
      const res = simulatorRef.current.setTarget(targetId);
      triggerNotification(res.message, "success");
    } else {
      // POST REST API call for set target snapshot
      fetch(`http://${rovIp}:8000/api/trajectory/set_target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId })
      })
        .then(res => res.json())
        .then(data => triggerNotification(data.message, "success"))
        .catch(() => triggerNotification("Gagal menyimpan snapshot target", "error"));
    }
  };

  // Screenshots & Record triggers
  const handleScreenshot = (cam) => {
    if (simulationMode) {
      triggerNotification(`[Sim] Screenshot kamera ${cam} disimpan`, "success");
    } else {
      fetch(`http://${rovIp}:8000/api/camera/${cam}/screenshot`, { method: "POST" })
        .then(() => triggerNotification(`Screenshot request sent for ${cam} camera`, "info"))
        .catch(() => triggerNotification("REST API screenshot error", "error"));
    }
  };

  const handleToggleRecord = (cam) => {
    const isRec = recordings[cam];
    const path = isRec ? "record/stop" : "record/start";
    
    setRecordings(prev => ({ ...prev, [cam]: !isRec }));

    if (simulationMode) {
      triggerNotification(`[Sim] Kamera ${cam} ${isRec ? "Stop" : "Mulai"} merekam`, isRec ? "warning" : "success");
    } else {
      fetch(`http://${rovIp}:8000/api/camera/${cam}/${path}`, { method: "POST" })
        .then(() => triggerNotification(`Recording ${isRec ? "stop" : "start"} sent for ${cam}`, "info"))
        .catch(() => triggerNotification("REST API recording control error", "error"));
    }
  };

  const handleClearQRHistory = () => {
    if (simulationMode) {
      setQrHistory([]);
      triggerNotification("QR history dihapus", "success");
    } else {
      fetch(`http://${rovIp}:8000/api/qr/history`, { method: "DELETE" })
        .then(() => {
          setQrHistory([]);
          triggerNotification("QR history dihapus", "success");
        })
        .catch(() => triggerNotification("Gagal menghapus QR history", "error"));
    }
  };

  const toggleMockSubsystem = (cam) => {
    if (simulationMode && simulatorRef.current) {
      simulatorRef.current.toggleMockCameraFailure(cam);
    }
  };

  return (
    <div className="dashboard">
      
      {/* 1. CRITICAL FULLSCREEN EMERGENCY OVERLAY */}
      {failsafe.emergency_active && (
        <div className="emergency-overlay">
          <ShieldAlert size={80} className="emergency-icon" />
          <div className="emergency-title">EMERGENCY SHUTDOWN ACTIVE</div>
          <div className="emergency-box">
            <strong>Reason:</strong> {failsafe.emergency_reason || "Operator Triggered E-Stop"}
            <div style={{ marginTop: "12px", fontSize: "14px", color: "var(--text-secondary)" }}>
              Sistem dinetralkan (RC overriding: neutral, Pixhawk: Disarmed). 
              Pelepasan membutuhkan konfirmasi operator.
            </div>
          </div>
          <button className="btn-emergency-clear" onClick={handleClearEmergency}>
            Clear Emergency
          </button>
        </div>
      )}

      {/* FLOATING NOTIFICATION CENTER */}
      <div style={{ position: "fixed", top: "20px", right: "20px", zIndex: 1000, display: "flex", flexDirection: "column", gap: "8px" }}>
        {notifications.map(n => (
          <div key={n.id} className="badge severity-info" style={{ 
            padding: "8px 16px", borderRadius: "6px", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px", 
            border: "1px solid",
            background: n.type === "success" ? "rgba(0, 255, 135, 0.15)" : n.type === "error" ? "rgba(255,0,60,0.15)" : "rgba(0, 242, 254, 0.15)",
            borderColor: n.type === "success" ? "var(--color-success)" : n.type === "error" ? "var(--color-emergency)" : "var(--color-cyan)",
            color: n.type === "success" ? "var(--color-success)" : n.type === "error" ? "var(--color-emergency)" : "var(--color-cyan)"
          }}>
            <AlertTriangle size={14} />
            {n.message}
          </div>
        ))}
      </div>

      {/* 2. HEADER */}
      <header className="header">
        <div className="header-brand">
          <Anchor size={24} className="header-logo" />
          <div>
            <div className="header-title">ROV Control Station</div>
            <div className="header-subtitle">Mission Command HUD • v2.0</div>
          </div>
        </div>

        {/* Dynamic IP Management and Simulation Selector */}
        <div className="simulation-box">
          <button 
            className={`btn-simulator-toggle ${simulationMode ? "active" : ""}`}
            onClick={() => setSimulationMode(!simulationMode)}
          >
            <Cpu size={12} style={{ marginRight: "4px" }} />
            SIMULATOR: {simulationMode ? "ON" : "OFF"}
          </button>

          <div className="connection-config">
            <Settings size={14} style={{ color: "var(--text-secondary)" }} />
            {isEditingIp ? (
              <>
                <input
                  type="text"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  style={{ width: "95px" }}
                />
                <button className="btn-connect" onClick={handleSaveIp}>Save</button>
              </>
            ) : (
              <>
                <span style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--color-cyan)", marginRight: "4px" }}>
                  {rovIp}
                </span>
                <button className="btn-connect" onClick={() => setIsEditingIp(true)}>Edit IP</button>
              </>
            )}
          </div>
        </div>

        {/* Connection status badges */}
        <div className="header-stats">
          <div className="stat-badge">
            <span style={{ color: "var(--text-secondary)", marginRight: "4px" }}>Websocket:</span>
            <div className={`status-dot ${socketConnected ? "active" : "inactive"}`} />
          </div>

          <div className="stat-badge">
            <span style={{ color: "var(--text-secondary)", marginRight: "4px" }}>MAVLink:</span>
            <div className={`status-dot ${mavlinkConnected ? "active" : "inactive"}`} />
          </div>

          <div className="stat-badge" style={{ fontFamily: "monospace" }}>
            <span style={{ color: "var(--text-secondary)", marginRight: "4px" }}>Ping:</span>
            <span style={{ color: "var(--color-cyan)" }}>{latency}ms</span>
          </div>

          {/* Subsystems failsafe badges */}
          <div className="system-badges">
            {Object.entries(failsafe.subsystems).map(([key, item]) => (
              <span
                key={key}
                className={`badge severity-${item.severity.toLowerCase()}`}
                title={item.message}
                onClick={() => key.startsWith("camera_") && toggleMockSubsystem(key.replace("camera_", ""))}
                style={{ cursor: simulationMode && key.startsWith("camera_") ? "pointer" : "default" }}
              >
                {key === "camera_front" ? "Cam F" : key === "camera_bottom" ? "Cam B" : key}
                : {item.ok ? "OK" : "ERR"}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* 3. MAIN (Feeds & Map) */}
      <main className="main-content">
        <div className="camera-grid">
          <CameraFeed
            camType="front"
            label="Kamera Depan"
            ip={rovIp}
            port={8001}
            isConnected={socketConnected && !simulationMode}
            simulationMode={simulationMode}
            simulationState={autonomous}
            recording={recordings.front}
            onScreenshot={handleScreenshot}
            onToggleRecord={handleToggleRecord}
          />
          <CameraFeed
            camType="bottom"
            label="Kamera Bawah"
            ip={rovIp}
            port={8002}
            isConnected={socketConnected && !simulationMode}
            simulationMode={simulationMode}
            simulationState={autonomous}
            recording={recordings.bottom}
            onScreenshot={handleScreenshot}
            onToggleRecord={handleToggleRecord}
          />
        </div>

        {/* 2D Trajectory Component */}
        <TrajectoryMap
          trajectory={trajectory}
          yaw={telemetry.yaw}
          targets={["TARGET_A", "TARGET_B", "TARGET_C"]}
          activeTarget={activeTarget}
          onResetPos={handleResetPos}
          onSetTarget={handleSetTrajectoryTarget}
          simulationMode={simulationMode}
        />
      </main>

      {/* 4. SIDEBAR (Telemetry & Autonomous) */}
      <aside className="sidebar">
        
        {/* Telemetry card */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Compass size={14} className="header-logo" />
              Telemetry Sensors
            </div>
            <span className={`badge ${telemetry.armed ? "severity-info" : "severity-warning"}`}>
              {telemetry.armed ? "ARMED ● ACTIVE" : "DISARMED"}
            </span>
          </div>

          <div className="telemetry-grid">
            <div className="telemetry-card">
              <span className="telemetry-label">Depth</span>
              <span className="telemetry-value-large">{telemetry.depth.toFixed(2)} m</span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Flight Mode</span>
              <span className="telemetry-value-large" style={{ fontSize: "20px", color: "var(--color-cyan)" }}>
                {telemetry.mode}
              </span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Roll / Pitch</span>
              <span className="telemetry-value-large" style={{ fontSize: "18px" }}>
                {telemetry.roll.toFixed(1)}° / {telemetry.pitch.toFixed(1)}°
              </span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Yaw Heading</span>
              <span className="telemetry-value-large" style={{ color: "var(--color-success)" }}>
                {telemetry.yaw.toFixed(1)}°
              </span>
            </div>
            
            {/* Battery state */}
            <div className="telemetry-card telemetry-card-full">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="telemetry-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <Battery size={14} /> Battery voltage
                </span>
                <span className="battery-volt-text">
                  {telemetry.battery_voltage.toFixed(1)}V • {telemetry.battery_current.toFixed(2)}A
                </span>
              </div>
              <div className="telemetry-value-large" style={{ fontSize: "26px", margin: "2px 0 0" }}>
                {telemetry.battery_remaining}%
              </div>
              <div className="battery-bar-container">
                <div
                  className="battery-bar"
                  style={{
                    width: `${telemetry.battery_remaining}%`,
                    backgroundColor: telemetry.battery_remaining > 50 ? "var(--color-success)" : telemetry.battery_remaining > 20 ? "var(--color-warning)" : "var(--color-emergency)"
                  }}
                />
              </div>
            </div>
          </div>

          <div className="keyboard-controls-helper">
            <HelpCircle size={12} />
            Keyboard: 
            <span className="key-tag">W/S</span> Fwd, 
            <span className="key-tag">A/D</span> Strafe, 
            <span className="key-tag">Q/E</span> Yaw, 
            <span className="key-tag">Space/Shift</span> Depth
          </div>
        </div>

        {/* Autonomous Mission Panel */}
        <div className="panel" style={{ flexGrow: 1 }}>
          <div className="panel-header">
            <div className="panel-title">
              <Activity size={14} className="header-logo" />
              Autonomous Mission
            </div>
          </div>

          <div className="mission-progress-container" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="mission-state-display">State: {autonomous.state}</div>

            <div className="mission-row">
              <span>Target:</span>
              <span className="mission-val">{autonomous.target_id || "NONE"}</span>
            </div>
            <div className="mission-row">
              <span>Elapsed Time:</span>
              <span className="mission-val">{autonomous.elapsed_s.toFixed(1)}s</span>
            </div>

            {/* Waypoints Progress bar */}
            {autonomous.waypoint_total > 0 && (
              <div>
                <div className="mission-row" style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  <span>Waypoints progress:</span>
                  <span>{autonomous.waypoint_index} / {autonomous.waypoint_total}</span>
                </div>
                <div className="progress-bar-outer">
                  <div 
                    className="progress-bar-inner"
                    style={{ width: `${(autonomous.waypoint_index / autonomous.waypoint_total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Scrollable Mission Log panel */}
            <span className="telemetry-label" style={{ marginTop: "4px" }}>Mission Event Log</span>
            <div className="mission-log-box">
              {autonomous.mission_log.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "11px", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
                  No mission events logged
                </div>
              ) : (
                autonomous.mission_log.map((log, idx) => (
                  <div key={idx} className="mission-log-entry">
                    <span className="mission-log-time">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`mission-log-msg type-${
                      log.type?.includes("success") || log.type?.includes("done") ? "success" : log.type?.includes("timeout") || log.type?.includes("abort") ? "danger" : "info"
                    }`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="mission-actions">
              <button
                className="btn-control armed-btn"
                disabled={autonomous.is_active || failsafe.emergency_active}
                onClick={handleStartAutonomous}
              >
                <Play size={12} style={{ marginRight: "4px" }} /> Start Auto
              </button>
              <button
                className="btn-control disarmed-btn"
                disabled={!autonomous.is_active}
                onClick={handleStopAutonomous}
              >
                <Square size={12} style={{ marginRight: "4px" }} /> Stop Auto
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* 5. FOOTER CONTROLS */}
      <footer className="control-bar">
        
        {/* Primary Command Strip */}
        <div className="control-buttons-row">
          
          {/* Arm / Disarm Group */}
          <div className="control-group">
            <span className="control-label">Thrusters</span>
            <button
              className={`btn-control ${telemetry.armed ? "disarmed-btn" : "armed-btn"}`}
              onClick={handleArmDisarm}
              disabled={autonomous.is_active || failsafe.emergency_active}
            >
              {telemetry.armed ? "DISARM" : "ARM"}
            </button>
          </div>

          {/* Mode Selector Group */}
          <div className="control-group">
            <span className="control-label">Flight Mode</span>
            <select
              value={telemetry.mode}
              className="control-select"
              onChange={(e) => handleSetMode(e.target.value)}
              disabled={autonomous.is_active || failsafe.emergency_active}
            >
              <option value="MANUAL">MANUAL</option>
              <option value="STABILIZE">STABILIZE</option>
              <option value="DEPTH_HOLD">DEPTH_HOLD</option>
              <option value="ACRO">ACRO</option>
              <option value="GUIDED">GUIDED</option>
              <option value="AUTO">AUTO</option>
              <option value="LOITER">LOITER</option>
              <option value="POSHOLD">POSHOLD</option>
            </select>
          </div>

          {/* Equipment controls */}
          <div className="control-group">
            <span className="control-label">Aux Systems</span>
            <button
              className={`btn-control ${telemetry.light_state ? "active-glow" : ""}`}
              onClick={handleLightToggle}
              disabled={failsafe.emergency_active}
            >
              <Lightbulb size={13} style={{ marginRight: "4px" }} /> Lampu
            </button>
            <button
              className="btn-control"
              onClick={() => handleGripper("open")}
              disabled={failsafe.emergency_active}
            >
              Gripper Open
            </button>
            <button
              className="btn-control"
              onClick={() => handleGripper("close")}
              disabled={failsafe.emergency_active}
            >
              Gripper Close
            </button>
          </div>

          {/* QR History trigger drawer toggle or popup */}
          <div className="control-group" style={{ border: "none" }}>
            <span className="control-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Layers size={13} /> QR Scanned
            </span>
            <span className="badge severity-info" style={{ fontWeight: 800 }}>
              {qrHistory.length} Detected
            </span>
            <button className="btn-control" onClick={handleClearQRHistory} style={{ fontSize: "11px", padding: "3px 8px" }}>
              Clear
            </button>
          </div>

          {/* Giant emergency E-Stop Button */}
          <button className="btn-estop" onClick={handleEmergencyStop}>
            <ShieldAlert size={16} /> EMERGENCY STOP
          </button>
        </div>

        {/* 6. FAILSAFE LOG PANEL */}
        <div className="failsafe-logs">
          <div className="failsafe-logs-header">
            <Terminal size={14} className="header-logo" />
            Failsafe Subsystem System Event Logs
          </div>
          
          <div className="failsafe-list">
            {failsafeEvents.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "11px" }}>
                No events logged
              </div>
            ) : (
              failsafeEvents.map((evt, idx) => (
                <div key={idx} className="failsafe-entry">
                  <span className="failsafe-time">
                    {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`failsafe-subsystem severity-${evt.severity.toLowerCase()}`}>
                    [{evt.subsystem}]
                  </span>
                  <span className="failsafe-msg">{evt.message}</span>
                  {evt.action && evt.action !== "none" && (
                    <span className="failsafe-act">Action: {evt.action}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </footer>
    </div>
  );
}
