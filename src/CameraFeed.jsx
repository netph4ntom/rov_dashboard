import React, { useRef, useEffect } from "react";
import { Camera, Video, AlertCircle, Play, Square } from "lucide-react";

export default function CameraFeed({
  camType, // "front" or "bottom"
  label, // "Kamera Depan" or "Kamera Bawah"
  ip,
  port,
  isConnected,
  simulationMode,
  simulationState, // autonomous state or coordinates
  recording,
  onScreenshot,
  onToggleRecord
}) {
  const simCanvasRef = useRef(null);
  const imgRef = useRef(null);

  // Simulating Live Camera Viewport on Canvas when in Simulation Mode
  useEffect(() => {
    if (!simulationMode || isConnected) return;

    const canvas = simCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let animationId;
    let bubbleTicks = 0;
    const bubbles = Array.from({ length: 15 }, () => ({
      x: Math.random() * 400,
      y: Math.random() * 300 + 300,
      r: Math.random() * 3 + 1,
      speed: Math.random() * 1.5 + 0.5
    }));

    const drawSimulation = () => {
      bubbleTicks++;
      const w = canvas.width = 400;
      const h = canvas.height = 300;

      // Dark blue underwater background
      const grad = ctx.createRadialGradient(w/2, h/2, 20, w/2, h/2, w);
      grad.addColorStop(0, "#101827");
      grad.addColorStop(1, "#05070a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Draw faint grid lines representing coordinates mapping
      ctx.strokeStyle = "rgba(0, 242, 254, 0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Draw bubbles floating up
      ctx.fillStyle = "rgba(0, 242, 254, 0.25)";
      bubbles.forEach(b => {
        b.y -= b.speed;
        if (b.y < -10) {
          b.y = h + 10;
          b.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      });

      if (camType === "front") {
        // Draw docking target (QR)
        let targetX = w / 2;
        let targetY = h / 2;

        if (simulationState?.state === "ALIGNING") {
          // Offsets: positive is right and down.
          // Translate offset to canvas delta
          targetX = w / 2 + (simulationState.qr_offset_x || 0);
          targetY = h / 2 + (simulationState.qr_offset_y || 0);
        } else if (simulationState?.state === "REPLAYING") {
          // target appears at edge and slowly enters
          const progress = (simulationState.waypoint_index / simulationState.waypoint_total);
          targetX = w * 1.2 - progress * (w * 0.7);
          targetY = h / 2 + Math.sin(progress * 10) * 40;
        } else if (simulationState?.state === "PICKUP" || simulationState?.state === "RETURNING") {
          targetX = w / 2;
          targetY = h / 2;
        } else {
          // Idle state - target stationary far away or out of frame
          targetX = w * 1.4;
          targetY = h / 2;
        }

        // Draw docking target box (QR outline) if visible
        if (targetX > -50 && targetX < w + 50) {
          ctx.strokeStyle = simulationState?.state === "PICKUP" ? "#00ff87" : "#ffb700";
          ctx.lineWidth = 3;
          ctx.shadowBlur = 10;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.beginPath();
          ctx.rect(targetX - 25, targetY - 25, 50, 50);
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Drawing mock QR internal squares
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillRect(targetX - 20, targetY - 20, 10, 10);
          ctx.fillRect(targetX + 10, targetY - 20, 10, 10);
          ctx.fillRect(targetX - 20, targetY + 10, 10, 10);
          ctx.fillRect(targetX - 5, targetY - 5, 10, 10);

          ctx.font = "9px Rajdhani";
          ctx.fillText("QR TARGET", targetX - 22, targetY - 30);
        }

        // Draw HUD overlay text info
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "10px Rajdhani";
        ctx.fillText(`CAM_FRONT: STANDBY | AUTO EXPOSURE`, 12, 22);
      } else {
        // Camera bottom: Draw docking station outline
        let dockX = w / 2;
        let dockY = h / 2;

        if (simulationState?.state === "ALIGNING") {
          dockX = w / 2 + (simulationState.qr_offset_x || 0) * 0.5;
          dockY = h / 2 + (simulationState.qr_offset_y || 0) * 0.5;
        } else if (simulationState?.state === "PICKUP" || simulationState?.state === "RETURNING") {
          dockX = w / 2;
          dockY = h / 2;
        } else if (simulationState?.state === "IDLE") {
          // Stationary offset
          dockX = w / 2 + 100;
          dockY = h / 2 + 50;
        } else {
          dockX = w / 2 + 150;
          dockY = h / 2 + 80;
        }

        // Draw docking platform circle
        ctx.strokeStyle = simulationState?.state === "PICKUP" ? "#00ff87" : "rgba(0, 242, 254, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(dockX, dockY, 40, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(dockX, dockY, 15, 0, Math.PI * 2);
        ctx.stroke();

        // Draw cross lines on dock
        ctx.beginPath();
        ctx.moveTo(dockX - 50, dockY); ctx.lineTo(dockX + 50, dockY);
        ctx.moveTo(dockX, dockY - 50); ctx.lineTo(dockX, dockY + 50);
        ctx.stroke();

        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "bold 9px Rajdhani";
        ctx.fillText("DOCK HATCH", dockX - 25, dockY - 45);

        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "10px Rajdhani";
        ctx.fillText(`CAM_BOTTOM: DOCK LOOKUP`, 12, 22);
      }

      // Digital Scanline effect
      ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
      for (let y = bubbleTicks % 4; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      animationId = requestAnimationFrame(drawSimulation);
    };

    drawSimulation();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [simulationMode, isConnected, simulationState, camType]);

  // Handle MJPEG Stream Offline retries
  const handleImageError = () => {
    if (isConnected && imgRef.current) {
      setTimeout(() => {
        if (imgRef.current) {
          imgRef.current.src = `http://${ip}:${port}/stream?t=${Date.now()}`;
        }
      }, 3000);
    }
  };

  const isAligningState = camType === "front" && simulationState?.state === "ALIGNING";
  const showDockAligned = camType === "bottom" && (simulationState?.state === "PICKUP" || simulationState?.state === "ALIGNING" && simulationState?.qr_offset_x === 0);

  return (
    <div className="panel" style={{ flexGrow: 1 }}>
      <div className="panel-header">
        <div className="panel-title">
          <Camera size={14} className="header-logo" />
          {label}
        </div>
        <div className="header-subtitle">Port: {port}</div>
      </div>

      <div className="camera-container">
        {/* Render simulated underwater viewport canvas or actual live camera feed */}
        {simulationMode && !isConnected ? (
          <canvas ref={simCanvasRef} className="camera-feed" />
        ) : isConnected ? (
          <img
            ref={imgRef}
            src={`http://${ip}:${port}/stream`}
            alt={label}
            className="camera-feed"
            onError={handleImageError}
          />
        ) : (
          <div className="camera-placeholder">
            <AlertCircle size={32} className="severity-emergency blink" />
            <div className="camera-placeholder-text">Camera Disconnected</div>
            <div style={{ fontSize: "12px" }}>http://{ip}:{port}/stream</div>
          </div>
        )}

        <div className="camera-overlay-info">
          <div className={`status-dot ${isConnected || (simulationMode && !isConnected) ? "active" : "inactive"}`} />
          {isConnected ? "LIVE" : simulationMode ? "SIMULATED" : "STANDBY"}
        </div>

        {/* Recording active banner overlay */}
        {recording && (
          <div className="rec-indicator">
            <div className="rec-dot" />
            REC
          </div>
        )}

        {/* QR Alignment HUD (Front Cam Only) */}
        {isAligningState && simulationState && (
          <div className="qr-hud-overlay">
            <div className={`hud-crosshair ${simulationState.qr_offset_x === 0 && simulationState.qr_offset_y === 0 ? "aligned" : ""}`} />
            
            {/* Draw target offset pointer */}
            <div
              className={`hud-target-dot ${simulationState.qr_offset_x === 0 && simulationState.qr_offset_y === 0 ? "aligned" : ""}`}
              style={{
                top: `calc(50% + ${simulationState.qr_offset_y || 0}px)`,
                left: `calc(50% + ${simulationState.qr_offset_x || 0}px)`
              }}
            />
            
            <div className="alignment-hud-coords">
              QR OFFSET | X: {simulationState.qr_offset_x > 0 ? "+" : ""}{simulationState.qr_offset_x}px, 
              Y: {simulationState.qr_offset_y > 0 ? "+" : ""}{simulationState.qr_offset_y}px
            </div>
          </div>
        )}

        {/* Dock Aligned overlay badge (Bottom Cam Only) */}
        {showDockAligned && (
          <div className="dock-align-badge">
            DOCK ALIGNED ● SUCCESS
          </div>
        )}

        {/* Action icons displayed overlay on card hover */}
        <div className="camera-actions">
          <button
            className="btn-cam-action"
            onClick={() => onScreenshot(camType)}
            title="Take Screenshot"
          >
            <Camera size={15} />
          </button>
          <button
            className={`btn-cam-action ${recording ? "recording" : ""}`}
            onClick={() => onToggleRecord(camType)}
            title={recording ? "Stop Recording" : "Start Recording"}
          >
            {recording ? <Square size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
