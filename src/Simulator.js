// Offline Simulator Engine for ROV Control Station
// Mocking the backend processes running at Ports 8000, 8001, and 8002.

export class RovSimulator {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.intervalId = null;
    this.tickCounter = 0;
    
    // Telemetry Initial State
    this.telemetry = {
      roll: -1.25,
      pitch: 0.43,
      yaw: 180.0,
      depth: 1.234,
      battery_voltage: 14.8,
      battery_current: 2.35,
      battery_remaining: 87,
      lat: 0.0,
      lon: 0.0,
      gps_fix: 0,
      armed: false,
      mode: "MANUAL",
      accel_x: 0.0012,
      accel_y: -0.0034,
      accel_z: 9.7812,
      gyro_x: 0.0001,
      gyro_y: -0.0002,
      gyro_z: 0.0000,
      last_update: Date.now() / 1000
    };

    // Trajectory Initial State
    this.trajectory = {
      current_pos: { x: 0.0, y: 0.0, depth: 0.0 },
      orientation: { roll: -1.25, pitch: 0.43, yaw: 180.0 },
      path: [
        { x: 0.0, y: 0.0, depth: 0.0, yaw: 180.0, timestamp: Date.now() / 1000 }
      ],
      timestamp: Date.now() / 1000
    };

    // Failsafe & Systems Health
    this.failsafe = {
      emergency_active: false,
      emergency_reason: "",
      subsystems: {
        mavlink:       { ok: true,  severity: "INFO",    message: "Heartbeat OK" },
        dashboard:     { ok: true,  severity: "INFO",    message: "Dashboard terhubung (Simulated)" },
        telemetry:     { ok: true,  severity: "INFO",    message: "Fresh" },
        camera_front:  { ok: true,  severity: "INFO",    message: "Kamera OK" },
        camera_bottom: { ok: true,  severity: "INFO",    message: "Kamera OK" },
        system:        { ok: true,  severity: "INFO",    message: "CPU 42% | RAM 58%" }
      }
    };

    // Autonomous State
    this.autonomous = {
      state: "IDLE",
      target_id: "",
      elapsed_s: 0,
      is_active: false,
      waypoint_index: 0,
      waypoint_total: 0,
      qr_offset_x: undefined,
      qr_offset_y: undefined
    };

    // Recording and historical data
    this.recordedWaypoints = [];
    this.qrHistory = [
      { data: "DOCKING_1", aligned: true, timestamp: (Date.now() - 3600000) / 1000, received_at: new Date(Date.now() - 3600000).toISOString() }
    ];
    this.targetSet = false;
    this.targetId = "";

    // Internal simulation timings
    this.autoStateTimer = 0;
    this.joystickOverrides = { "1": 1500, "2": 1500, "3": 1500, "4": 1500 };
  }

  start() {
    this.stop();
    this.onEvent("connect", {});
    this.onEvent("mavlink_status", { connected: true });
    this.onEvent("failsafe_status", this.failsafe);
    this.onEvent("telemetry_update", this.telemetry);
    this.onEvent("trajectory_update", this.trajectory);
    
    // Core loop at 10Hz (100ms interval)
    this.intervalId = setInterval(() => this.tick(), 100);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  tick() {
    this.tickCounter++;
    
    // Simulate battery decay and telemetry jitter
    if (this.tickCounter % 100 === 0) { // every 10 seconds
      this.telemetry.battery_voltage = Math.max(10.5, +(this.telemetry.battery_voltage - 0.02).toFixed(2));
      this.telemetry.battery_remaining = Math.max(0, Math.round((this.telemetry.battery_voltage - 10.5) / 4.3 * 100));
      
      // Update simulated system stats
      const cpu = Math.floor(40 + Math.random() * 15);
      const ram = Math.floor(55 + Math.random() * 8);
      this.failsafe.subsystems.system = { ok: true, severity: "INFO", message: `CPU ${cpu}% | RAM ${ram}%` };
      this.onEvent("failsafe_status", this.failsafe);
    }

    // Fluctuate sensor noise slightly
    this.telemetry.roll = +(-1.25 + Math.sin(this.tickCounter * 0.1) * 0.3).toFixed(2);
    this.telemetry.pitch = +(0.43 + Math.cos(this.tickCounter * 0.15) * 0.2).toFixed(2);
    
    // Apply manual control dynamics (CH 1-4 overrides)
    if (this.telemetry.armed && this.autonomous.state === "IDLE") {
      const latSpeed = (this.joystickOverrides["1"] - 1500) / 400; // Lateral
      const fwdSpeed = (this.joystickOverrides["2"] - 1500) / 400; // Forward
      const vertSpeed = (this.joystickOverrides["3"] - 1500) / 400; // Throttle
      const yawSpeed = (this.joystickOverrides["4"] - 1500) / 400; // Yaw
      
      this.telemetry.battery_current = +(1.5 + Math.abs(latSpeed) * 3 + Math.abs(fwdSpeed) * 4 + Math.abs(vertSpeed) * 5 + Math.abs(yawSpeed) * 2).toFixed(2);
      
      if (Math.abs(fwdSpeed) > 0.05 || Math.abs(latSpeed) > 0.05 || Math.abs(vertSpeed) > 0.05 || Math.abs(yawSpeed) > 0.05) {
        // Move ROV coordinates based on yaw heading
        const rad = (this.telemetry.yaw * Math.PI) / 180;
        const dx = (fwdSpeed * Math.cos(rad) - latSpeed * Math.sin(rad)) * 0.15;
        const dy = (fwdSpeed * Math.sin(rad) + latSpeed * Math.cos(rad)) * 0.15;
        
        this.trajectory.current_pos.x = +(this.trajectory.current_pos.x + dx).toFixed(3);
        this.trajectory.current_pos.y = +(this.trajectory.current_pos.y + dy).toFixed(3);
        this.trajectory.current_pos.depth = Math.max(0, +(this.trajectory.current_pos.depth + vertSpeed * 0.08).toFixed(3));
        
        this.telemetry.depth = this.trajectory.current_pos.depth;
        this.telemetry.yaw = (this.telemetry.yaw + yawSpeed * 3) % 360;
        if (this.telemetry.yaw < 0) this.telemetry.yaw += 360;
        this.telemetry.yaw = +this.telemetry.yaw.toFixed(2);
        
        this.trajectory.orientation.yaw = this.telemetry.yaw;
        
        // Record trajectory trail
        if (this.tickCounter % 5 === 0) { // 2Hz trail logging
          this.recordedWaypoints.push({
            x: this.trajectory.current_pos.x,
            y: this.trajectory.current_pos.y,
            depth: this.trajectory.current_pos.depth,
            yaw: this.telemetry.yaw,
            timestamp: Date.now() / 1000
          });
          this.trajectory.path = [...this.recordedWaypoints];
          this.onEvent("trajectory_update", this.trajectory);
        }
      } else {
        this.telemetry.battery_current = +(1.2 + Math.random() * 0.3).toFixed(2);
      }
    }

    // Autonomous Mission Replay tick
    if (this.autonomous.is_active && !this.failsafe.emergency_active) {
      this.autonomous.elapsed_s = +(this.autonomous.elapsed_s + 0.1).toFixed(1);
      this.autoStateTimer += 0.1;
      
      const speedMult = 2; // Speed up trajectory replaying for simulator comfort
      
      switch (this.autonomous.state) {
        case "REPLAYING":
          this.autonomous.waypoint_index = Math.min(
            this.autonomous.waypoint_total,
            this.autonomous.waypoint_index + speedMult
          );
          
          // Move ROV pos along the path
          if (this.trajectory.path.length > 0) {
            const idx = Math.min(this.autonomous.waypoint_index, this.trajectory.path.length - 1);
            const pt = this.trajectory.path[idx];
            this.trajectory.current_pos = { x: pt.x, y: pt.y, depth: pt.depth };
            this.telemetry.depth = pt.depth;
            this.telemetry.yaw = pt.yaw;
            this.trajectory.orientation.yaw = pt.yaw;
          }
          
          this.onEvent("autonomous_status", this.autonomous);
          
          if (this.autonomous.waypoint_index >= this.autonomous.waypoint_total) {
            this.autonomous.state = "ALIGNING";
            this.autoStateTimer = 0;
            this.autonomous.qr_offset_x = 110;
            this.autonomous.qr_offset_y = -95;
            this.onEvent("mission_event", { type: "qr_searching", message: "Misi: Mencari QR Code...", timestamp: new Date().toISOString() });
            this.onEvent("autonomous_status", this.autonomous);
          }
          break;

        case "ALIGNING":
          // Decrease offsets to simulate alignment
          const easeRate = 0.08;
          this.autonomous.qr_offset_x = Math.round(this.autonomous.qr_offset_x * (1 - easeRate));
          this.autonomous.qr_offset_y = Math.round(this.autonomous.qr_offset_y * (1 - easeRate));
          
          // Add telemetry noise during alignment
          this.trajectory.current_pos.x += (Math.random() - 0.5) * 0.005;
          this.trajectory.current_pos.y += (Math.random() - 0.5) * 0.005;
          
          this.onEvent("autonomous_status", this.autonomous);

          if (Math.abs(this.autonomous.qr_offset_x) <= 3 && Math.abs(this.autonomous.qr_offset_y) <= 3) {
            this.autonomous.qr_offset_x = 0;
            this.autonomous.qr_offset_y = 0;
            this.autonomous.state = "PICKUP";
            this.autoStateTimer = 0;
            this.onEvent("dock_aligned", { aligned: true, timestamp: Date.now() / 1000 });
            this.onEvent("mission_event", { type: "qr_aligned", message: "Misi: QR Code sejajar! Memulai docking sequence.", timestamp: new Date().toISOString() });
            
            // Add QR code to scan history
            const qrVal = "TARGET_QR_" + this.autonomous.target_id;
            this.qrHistory.unshift({
              data: qrVal,
              aligned: true,
              timestamp: Date.now() / 1000,
              received_at: new Date().toISOString()
            });
            this.onEvent("qr_detected", { data: qrVal, aligned: true, timestamp: Date.now() / 1000, source: "bottom" });
            
            this.onEvent("mission_event", { type: "pickup_start", message: "Misi: Gripper membuka...", timestamp: new Date().toISOString() });
            this.onEvent("autonomous_status", this.autonomous);
          }
          break;

        case "PICKUP":
          if (this.autoStateTimer >= 1.5 && this.autoStateTimer < 1.6) {
            this.onEvent("mission_event", { type: "pickup_advance", message: "Misi: ROV perlahan maju memasukkan objek.", timestamp: new Date().toISOString() });
          } else if (this.autoStateTimer >= 3.0 && this.autoStateTimer < 3.1) {
            this.onEvent("mission_event", { type: "pickup_close", message: "Misi: Gripper menjepit objek...", timestamp: new Date().toISOString() });
          } else if (this.autoStateTimer >= 4.5) {
            this.onEvent("mission_event", { type: "pickup_done", message: "Misi: Objek berhasil diamankan! Memulai perjalanan kembali.", timestamp: new Date().toISOString() });
            this.autonomous.state = "RETURNING";
            this.autoStateTimer = 0;
            this.autonomous.qr_offset_x = undefined;
            this.autonomous.qr_offset_y = undefined;
            this.onEvent("autonomous_status", this.autonomous);
          }
          break;

        case "RETURNING":
          this.autonomous.waypoint_index = Math.max(
            0,
            this.autonomous.waypoint_index - speedMult
          );
          
          if (this.trajectory.path.length > 0) {
            const idx = Math.min(this.autonomous.waypoint_index, this.trajectory.path.length - 1);
            const pt = this.trajectory.path[idx];
            this.trajectory.current_pos = { x: pt.x, y: pt.y, depth: pt.depth };
            this.telemetry.depth = pt.depth;
            this.telemetry.yaw = (pt.yaw + 180) % 360; // return heading inverted
            this.trajectory.orientation.yaw = this.telemetry.yaw;
          }
          
          this.onEvent("autonomous_status", this.autonomous);
          
          if (this.autonomous.waypoint_index <= 0) {
            this.autonomous.state = "COMPLETE";
            this.autonomous.is_active = false;
            this.telemetry.armed = false;
            this.telemetry.mode = "MANUAL";
            
            this.onEvent("autonomous_status", this.autonomous);
            this.onEvent("mission_complete", {
              success: true,
              target_id: this.autonomous.target_id,
              duration_s: this.autonomous.elapsed_s,
              reason: "Target Pickup Berhasil",
              timestamp: new Date().toISOString()
            });
            this.onEvent("telemetry_update", this.telemetry);
            
            this.autonomous.state = "IDLE";
          }
          break;
      }
    }

    // Always emit telemetry updates at 10Hz
    this.onEvent("telemetry_update", this.telemetry);
    
    // Emit trajectory positions at 2Hz
    if (this.tickCounter % 5 === 0) {
      this.onEvent("trajectory_update", this.trajectory);
    }
  }

  receiveCommand(event, payload) {
    console.log(`[Simulator RX] ${event}`, payload);
    
    switch (event) {
      case "cmd_arm":
        this.telemetry.armed = true;
        this.onEvent("telemetry_update", this.telemetry);
        this.addFailsafeEvent("telemetry", "INFO", "ROV Pixhawk Armed", "none");
        break;

      case "cmd_disarm":
        this.telemetry.armed = false;
        this.onEvent("telemetry_update", this.telemetry);
        this.addFailsafeEvent("telemetry", "INFO", "ROV Pixhawk Disarmed", "none");
        break;

      case "cmd_set_mode":
        this.telemetry.mode = payload.mode;
        this.onEvent("telemetry_update", this.telemetry);
        break;

      case "cmd_gripper":
        this.onEvent("mission_event", { 
          type: "manual_gripper", 
          message: `Manual: Gripper ${payload.action.toUpperCase()}`, 
          timestamp: new Date().toISOString() 
        });
        break;

      case "cmd_light":
        this.onEvent("mission_event", { 
          type: "manual_light", 
          message: `Manual: Lampu ${payload.state ? "NYALA" : "MATI"}`, 
          timestamp: new Date().toISOString() 
        });
        break;

      case "cmd_rc_override":
        this.joystickOverrides = { ...payload.channels };
        break;

      case "cmd_emergency_stop":
        this.failsafe.emergency_active = true;
        this.failsafe.emergency_reason = payload.reason || "Operator Emergency Stop";
        this.telemetry.armed = false;
        this.telemetry.mode = "MANUAL";
        this.autonomous.is_active = false;
        this.autonomous.state = "IDLE";
        this.joystickOverrides = { "1": 1500, "2": 1500, "3": 1500, "4": 1500 };
        
        this.onEvent("emergency_stop", {
          timestamp: new Date().toISOString(),
          severity: "EMERGENCY",
          message: this.failsafe.emergency_reason,
          action: "rc_neutral + disarm",
          requires_operator_clearance: true
        });
        this.onEvent("failsafe_status", this.failsafe);
        this.onEvent("telemetry_update", this.telemetry);
        this.onEvent("autonomous_status", this.autonomous);
        break;

      case "cmd_clear_emergency":
        this.failsafe.emergency_active = false;
        this.failsafe.emergency_reason = "";
        this.onEvent("failsafe_status", this.failsafe);
        this.addFailsafeEvent("system", "INFO", "Status emergency di-clear oleh operator", "recovery_done");
        break;

      case "cmd_autonomous_start":
        if (this.failsafe.emergency_active) return;
        this.autonomous.target_id = payload.target_id;
        this.autonomous.is_active = true;
        this.autonomous.elapsed_s = 0;
        this.autonomous.state = "REPLAYING";
        
        // If they haven't recorded waypoints, generate a dummy path for replay demonstration
        if (this.trajectory.path.length <= 1) {
          this.generateDummyPath();
        }
        
        this.autonomous.waypoint_index = 0;
        this.autonomous.waypoint_total = this.trajectory.path.length;
        this.telemetry.armed = true;
        this.telemetry.mode = "AUTO";
        
        this.onEvent("telemetry_update", this.telemetry);
        this.onEvent("mission_event", { type: "mission_started", message: `Misi dimulai untuk target: ${payload.target_id}`, timestamp: new Date().toISOString() });
        this.onEvent("autonomous_status", this.autonomous);
        break;

      case "cmd_autonomous_stop":
        this.autonomous.is_active = false;
        this.autonomous.state = "IDLE";
        this.telemetry.mode = "MANUAL";
        this.onEvent("autonomous_status", this.autonomous);
        this.onEvent("mission_complete", {
          success: false,
          target_id: this.autonomous.target_id,
          duration_s: this.autonomous.elapsed_s,
          reason: payload.reason || "Dibatalkan operator",
          timestamp: new Date().toISOString()
        });
        this.onEvent("telemetry_update", this.telemetry);
        break;
        
      case "ping_rov":
        this.onEvent("pong_rov", { echo: { ts: payload.ts } });
        break;
        
      default:
        break;
    }
  }

  // Generate a mock loop trail for replaying if path is empty
  generateDummyPath() {
    this.recordedWaypoints = [];
    const pts = 60;
    for (let i = 0; i <= pts; i++) {
      const radius = 2.0;
      const angle = (i / pts) * Math.PI * 0.7; // arc angle
      const x = +(radius * Math.sin(angle)).toFixed(3);
      const y = +(radius * (1 - Math.cos(angle))).toFixed(3);
      const depth = +(i * 0.03).toFixed(3);
      const yaw = +((angle * 180) / Math.PI + 180).toFixed(2);
      this.recordedWaypoints.push({
        x, y, depth, yaw,
        timestamp: Date.now() / 1000 + i
      });
    }
    this.trajectory.path = [...this.recordedWaypoints];
    this.onEvent("trajectory_update", this.trajectory);
  }

  resetTrajectory() {
    this.recordedWaypoints = [];
    this.trajectory.current_pos = { x: 0.0, y: 0.0, depth: 0.0 };
    this.trajectory.path = [
      { x: 0.0, y: 0.0, depth: 0.0, yaw: this.telemetry.yaw, timestamp: Date.now() / 1000 }
    ];
    this.telemetry.depth = 0.0;
    this.onEvent("trajectory_update", this.trajectory);
    this.onEvent("mission_event", { type: "reset_pos", message: "Posisi estimasi di-reset ke origin (0,0,0)", timestamp: new Date().toISOString() });
  }

  setTarget(targetId) {
    this.targetId = targetId;
    this.targetSet = true;
    this.onEvent("mission_event", {
      type: "set_target",
      message: `Snapshot target '${targetId}' disimpan dengan ${this.trajectory.path.length} waypoints`,
      timestamp: new Date().toISOString()
    });
    return {
      message: `Target '${targetId}' snapshot disimpan`,
      target_id: targetId,
      waypoints: this.trajectory.path.length
    };
  }

  addFailsafeEvent(subsystem, severity, message, action) {
    this.onEvent("failsafe_event", {
      timestamp: new Date().toISOString(),
      subsystem,
      severity,
      message,
      action
    });
  }

  // Trigger a custom test warning/error on camera subsystems from UI
  toggleMockCameraFailure(cam) {
    const key = `camera_${cam}`;
    const subsystem = this.failsafe.subsystems[key];
    if (subsystem.ok) {
      subsystem.ok = false;
      subsystem.severity = "WARNING";
      subsystem.message = "Health check gagal (Simulated)";
      this.addFailsafeEvent(key, "WARNING", "Subsystem health check failed", "autorecover_cam");
    } else {
      subsystem.ok = true;
      subsystem.severity = "INFO";
      subsystem.message = "Kamera OK";
      this.addFailsafeEvent(key, "INFO", "Kamera kembali online", "none");
    }
    this.onEvent("failsafe_status", this.failsafe);
  }
}
