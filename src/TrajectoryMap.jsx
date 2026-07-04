import React, { useRef, useEffect, useState } from "react";
import { RefreshCw, Flag, ZoomIn, ZoomOut, Maximize } from "lucide-react";

export default function TrajectoryMap({
  trajectory,
  yaw,
  targets,
  activeTarget,
  onResetPos,
  onSetTarget,
  simulationMode
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // Viewport State (Zoom and Pan in pixels)
  const [scale, setScale] = useState(50); // pixels per meter
  const [pan, setPan] = useState({ x: 0, y: 0 }); // offset in meters from origin (0,0)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedTarget, setSelectedTarget] = useState("TARGET_A");

  // Track target locations when operator locks target
  const [targetPositions, setTargetPositions] = useState({});

  useEffect(() => {
    // When target is saved in UI, snapshot current ROV pos as target location
    if (activeTarget && trajectory?.current_pos) {
      setTargetPositions(prev => ({
        ...prev,
        [activeTarget]: { ...trajectory.current_pos }
      }));
    }
  }, [activeTarget]);

  // Recenter map on ROV
  const handleRecenter = () => {
    if (trajectory?.current_pos) {
      setPan({ x: trajectory.current_pos.x, y: trajectory.current_pos.y });
    } else {
      setPan({ x: 0, y: 0 });
    }
  };

  // Canvas Drawing Logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Set resolution match bounding box
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;

    // Clear background
    ctx.fillStyle = "#090b10";
    ctx.fillRect(0, 0, w, h);

    // Helpers to convert meters to canvas pixels
    const toCanvasX = (mX) => w / 2 + (mX - pan.x) * scale;
    const toCanvasY = (mY) => h / 2 - (mY - pan.y) * scale; // Invert Y axis

    // Draw Grid Lines (every 1 meter)
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.font = "10px monospace";
    ctx.fillStyle = "#64748b";

    const xStart = Math.floor(pan.x - (w / 2) / scale) - 1;
    const xEnd = Math.ceil(pan.x + (w / 2) / scale) + 1;
    const yStart = Math.floor(pan.y - (h / 2) / scale) - 1;
    const yEnd = Math.ceil(pan.y + (h / 2) / scale) + 1;

    for (let x = xStart; x <= xEnd; x++) {
      const cx = toCanvasX(x);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();

      // Coordinate Labels
      if (x % 2 === 0) {
        ctx.fillText(`${x}m`, cx + 3, h - 5);
      }
    }

    for (let y = yStart; y <= yEnd; y++) {
      const cy = toCanvasY(y);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();

      // Coordinate Labels
      if (y % 2 === 0) {
        ctx.fillText(`${y}m`, 5, cy - 3);
      }
    }

    // Draw Radar rings centered at origin (0,0)
    ctx.strokeStyle = "rgba(0, 242, 254, 0.06)";
    ctx.lineWidth = 1;
    const origX = toCanvasX(0);
    const origY = toCanvasY(0);
    [1, 2, 3, 4, 5].forEach((radius) => {
      ctx.beginPath();
      ctx.arc(origX, origY, radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Draw Origin (Docking Station)
    ctx.fillStyle = "#ff003c"; // Red origin marker
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(255, 0, 60, 0.5)";
    ctx.beginPath();
    ctx.arc(origX, origY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow

    ctx.fillStyle = "#ff003c";
    ctx.font = "bold 10px Rajdhani";
    ctx.fillText("DOCKING STATION", origX + 8, origY + 4);

    // Draw Trajectory Trail Path
    if (trajectory?.path && trajectory.path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#00ff87"; // Neon Green trail
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 4;
      ctx.shadowColor = "rgba(0, 255, 135, 0.4)";
      
      const firstPt = trajectory.path[0];
      ctx.moveTo(toCanvasX(firstPt.x), toCanvasY(firstPt.y));
      
      for (let i = 1; i < trajectory.path.length; i++) {
        const pt = trajectory.path[i];
        ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset
    }

    // Draw saved target positions
    Object.entries(targetPositions).forEach(([id, pos]) => {
      const tx = toCanvasX(pos.x);
      const ty = toCanvasY(pos.y);
      
      // Draw Target Marker X
      ctx.strokeStyle = "#ffb700"; // Yellow target
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx - 6, ty - 6);
      ctx.lineTo(tx + 6, ty + 6);
      ctx.moveTo(tx + 6, ty - 6);
      ctx.lineTo(tx - 6, ty + 6);
      ctx.stroke();

      // Label target
      ctx.fillStyle = "#ffb700";
      ctx.font = "bold 10px Rajdhani";
      ctx.fillText(id, tx + 8, ty - 4);
    });

    // Draw active target placeholder if not reached yet
    if (activeTarget && !targetPositions[activeTarget] && trajectory?.current_pos) {
      // Mock targeted coordinates ahead of ROV path for demo
      const tx = toCanvasX(2.0);
      const ty = toCanvasY(2.0);
      ctx.strokeStyle = "rgba(255, 183, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(tx, ty, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 183, 0, 0.7)";
      ctx.font = "italic 10px Rajdhani";
      ctx.fillText(`${activeTarget} (Target)`, tx + 10, ty + 3);
    }

    // Draw Current ROV Position
    if (trajectory?.current_pos) {
      const rx = toCanvasX(trajectory.current_pos.x);
      const ry = toCanvasY(trajectory.current_pos.y);

      // Draw outer pulse
      ctx.fillStyle = "rgba(0, 242, 254, 0.15)";
      ctx.beginPath();
      ctx.arc(rx, ry, 16, 0, Math.PI * 2);
      ctx.fill();

      // Draw core dot
      ctx.fillStyle = "#00f2fe"; // Neon Cyan
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(0, 242, 254, 0.6)";
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0; // Reset

      // Heading indicator wedge (Yaw)
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      // In canvas, 0 deg is right, yaw usually 0 is North/up.
      // Standard conversion: yaw in degrees. North = 0 deg, East = 90 deg.
      // Canvas angle in rad = (yaw - 90) * PI / 180
      const headingRad = ((yaw ?? 0) - 90) * Math.PI / 180;
      
      ctx.moveTo(rx, ry);
      ctx.lineTo(
        rx + Math.cos(headingRad) * 20,
        ry + Math.sin(headingRad) * 20
      );
      ctx.stroke();

      // Position text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px Rajdhani";
      ctx.fillText(
        `X: ${trajectory.current_pos.x.toFixed(2)}m, Y: ${trajectory.current_pos.y.toFixed(2)}m`,
        rx + 10,
        ry + 15
      );
    }
  }, [trajectory, yaw, scale, pan, targetPositions, activeTarget]);

  // Drag handlers for Panning
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStart.x) / scale;
    const dy = (e.clientY - dragStart.y) / scale;
    setPan(prev => ({ x: prev.x - dx, y: prev.y + dy })); // Y is inverted
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoom = (factor) => {
    setScale(prev => Math.max(15, Math.min(150, Math.round(prev * factor))));
  };

  return (
    <div className="panel trajectory-panel" ref={containerRef}>
      <div className="panel-header">
        <div className="panel-title">
          <Flag size={16} className="header-logo" />
          Trajectory Map (Dead Reckoning 2D)
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button className="btn-trajectory" style={{ padding: "4px" }} onClick={() => handleZoom(1.2)} title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <button className="btn-trajectory" style={{ padding: "4px" }} onClick={() => handleZoom(0.8)} title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <button className="btn-trajectory" style={{ padding: "4px" }} onClick={handleRecenter} title="Re-center on ROV">
            <Maximize size={14} />
          </button>
        </div>
      </div>

      <div className="trajectory-canvas-container">
        <canvas
          ref={canvasRef}
          className="trajectory-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        
        <div className="trajectory-overlay-controls">
          <button className="btn-trajectory" onClick={onResetPos}>
            <RefreshCw size={13} style={{ marginRight: "4px", display: "inline-block" }} />
            Reset Pos
          </button>
          
          <select 
            value={selectedTarget} 
            onChange={(e) => setSelectedTarget(e.target.value)}
          >
            <option value="TARGET_A">TARGET_A</option>
            <option value="TARGET_B">TARGET_B</option>
            <option value="TARGET_C">TARGET_C</option>
          </select>
          
          <button className="btn-trajectory" onClick={() => onSetTarget(selectedTarget)}>
            Set Target
          </button>
        </div>
      </div>
    </div>
  );
}
