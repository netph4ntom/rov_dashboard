import { useState, useEffect } from "react";
import { io } from "socket.io-client";

const SOCKET_URL      = "http://localhost:8000";
const MJPEG_FRONT_URL  = "http://localhost:8001/stream";
const MJPEG_BOTTOM_URL = "http://localhost:8002/stream";

export default function QRDashboard() {
  const [qrResult, setQrResult]   = useState(null);
  const [wsStatus, setWsStatus]   = useState("connecting");
  const [history,  setHistory]    = useState([]);
  const [dockStatus, setDockStatus] = useState(null); // "aligned" | "lost" | null

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });

    socket.on("connect",       () => setWsStatus("open"));
    socket.on("disconnect",    () => setWsStatus("closed"));
    socket.on("connect_error", () => setWsStatus("error"));

    socket.on("qr_detected", (data) => {
      const entry = {
        text: data.data ?? data.result ?? data.text ?? JSON.stringify(data),
        aligned: data.aligned,
        time: new Date().toLocaleTimeString(),
      };
      setQrResult(entry);
      setHistory((prev) => [entry, ...prev].slice(0, 10));
    });

    socket.on("dock_aligned", () => setDockStatus("aligned"));
    socket.on("dock_lost",    () => setDockStatus("lost"));

    return () => socket.disconnect();
  }, []);

  const statusColor = {
    connecting: "#f59e0b",
    open:       "#22c55e",
    closed:     "#ef4444",
    error:      "#ef4444",
  }[wsStatus];

  const statusLabel = {
    connecting: "Connecting…",
    open:       "Connected",
    closed:     "Disconnected — retrying…",
    error:      "Connection Error",
  }[wsStatus];

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>⬡</span>
          <span style={s.title}>ROV Dashboard</span>
        </div>
        <div style={s.headerRight}>
          {dockStatus && (
            <div style={{
              ...s.dockPill,
              background: dockStatus === "aligned" ? "#14532d" : "#450a0a",
              borderColor: dockStatus === "aligned" ? "#22c55e" : "#ef4444",
              color:       dockStatus === "aligned" ? "#22c55e" : "#ef4444",
            }}>
              {dockStatus === "aligned" ? "⚓ Dock Aligned" : "✕ Dock Lost"}
            </div>
          )}
          <div style={s.statusPill}>
            <span style={{ ...s.dot, background: statusColor }} />
            <span style={s.statusText}>{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div style={s.grid}>
        {/* Left — Front Camera */}
        <CameraFeed label="Front Camera" url={MJPEG_FRONT_URL} large />

        {/* Right column */}
        <div style={s.rightCol}>
          {/* Top right — Bottom Camera */}
          <CameraFeed label="Bottom Camera" url={MJPEG_BOTTOM_URL} />

          {/* Bottom right — QR result */}
          <div style={s.qrCard}>
            <div style={s.cardLabel}>QR Code</div>
            <div style={s.qrInner}>
              <div style={s.qrIconBox}>
                <QRIcon active={!!qrResult} />
                {qrResult && <span style={s.qrBadge}>✓</span>}
              </div>
              <div style={s.qrResultBox}>
                {qrResult ? (
                  <>
                    <p style={s.qrResultLabel}>Hasil QR Code</p>
                    <p style={s.qrResultText}>{qrResult.text}</p>
                    <p style={s.qrResultTime}>{qrResult.time}</p>
                    {qrResult.aligned !== undefined && (
                      <span style={{
                        ...s.alignedBadge,
                        background: qrResult.aligned ? "#14532d" : "#292524",
                        color:      qrResult.aligned ? "#22c55e" : "#78716c",
                      }}>
                        {qrResult.aligned ? "✓ Aligned" : "○ Not Aligned"}
                      </span>
                    )}
                    {history.length > 1 && (
                      <div style={s.historyBox}>
                        <p style={s.historyLabel}>Riwayat</p>
                        {history.slice(1).map((h, i) => (
                          <div key={i} style={s.historyRow}>
                            <span style={s.historyText}>{h.text}</span>
                            <span style={s.historyTime}>{h.time}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p style={s.qrEmpty}>Arahkan QR ke kamera…</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CameraFeed({ label, url, large }) {
  const [error, setError] = useState(false);

  return (
    <div style={{ ...s.cameraCard, ...(large ? s.cameraCardLarge : {}) }}>
      <div style={s.cardLabel}>{label}</div>
      {!error ? (
        <img
          src={url}
          alt={label}
          style={s.cameraImg}
          onError={() => setError(true)}
        />
      ) : (
        <div style={s.cameraFallback}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5">
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
          </svg>
          <p style={s.fallbackText}>No signal</p>
          <p style={s.fallbackSub}>{url}</p>
        </div>
      )}
    </div>
  );
}

function QRIcon({ active }) {
  const c = active ? "#0f172a" : "#475569";
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="5" y="5" width="3" height="3" fill={c} stroke="none"/>
      <rect x="16" y="5" width="3" height="3" fill={c} stroke="none"/>
      <rect x="5" y="16" width="3" height="3" fill={c} stroke="none"/>
      <path d="M14 14h2v2h-2zM18 14h3v2h-3zM14 18h3v3h-3zM19 19h2v2h-2z" fill={c} stroke="none"/>
    </svg>
  );
}

/* ── Styles ── */
const s = {
  root: {
    minHeight: "100vh",
    background: "#0f172a",
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    color: "#e2e8f0",
    display: "flex",
    flexDirection: "column",
    padding: "18px 22px 22px",
    gap: 14,
    boxSizing: "border-box",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  logo: { fontSize: 22, color: "#38bdf8" },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: "0.02em", color: "#f1f5f9" },
  statusPill: {
    display: "flex", alignItems: "center", gap: 7,
    background: "#1e293b", border: "1px solid #334155",
    borderRadius: 99, padding: "5px 14px",
  },
  dockPill: {
    display: "flex", alignItems: "center", gap: 7,
    border: "1px solid", borderRadius: 99,
    padding: "5px 14px", fontSize: 12, fontWeight: 600,
  },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  statusText: { fontSize: 12, color: "#94a3b8" },

  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 380px",
    gap: 14,
    flex: 1,
  },

  cameraCard: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    position: "relative",
    overflow: "hidden",
    minHeight: 200,
  },
  cameraCardLarge: { minHeight: 400 },
  cameraImg: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    objectFit: "cover", borderRadius: 10,
  },
  cameraFallback: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 24,
  },
  fallbackText: { margin: 0, color: "#475569", fontSize: 13, fontWeight: 500 },
  fallbackSub:  { margin: 0, color: "#334155", fontSize: 10, fontFamily: "monospace" },

  cardLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: "#38bdf8",
    position: "relative", zIndex: 1,
  },

  rightCol: { display: "flex", flexDirection: "column", gap: 14 },

  qrCard: {
    background: "#1e293b", border: "1px solid #334155",
    borderRadius: 16, padding: 14,
    display: "flex", flexDirection: "column", gap: 10, flex: 1,
  },
  qrInner:     { display: "flex", gap: 14, alignItems: "flex-start", flex: 1 },
  qrIconBox:   { background: "#f1f5f9", borderRadius: 12, padding: 10, flexShrink: 0, position: "relative" },
  qrBadge: {
    position: "absolute", top: -6, right: -6,
    background: "#22c55e", color: "#fff",
    fontSize: 10, fontWeight: 700,
    borderRadius: 99, width: 18, height: 18,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  qrResultBox:   { flex: 1, display: "flex", flexDirection: "column", gap: 5 },
  qrResultLabel: { margin: 0, fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" },
  qrResultText:  { margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9", wordBreak: "break-all", lineHeight: 1.5 },
  qrResultTime:  { margin: 0, fontSize: 11, color: "#475569" },
  qrEmpty:       { margin: 0, fontSize: 13, color: "#475569", fontStyle: "italic", marginTop: 4 },
  alignedBadge:  { fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "2px 8px", width: "fit-content" },

  historyBox: {
    marginTop: 8, borderTop: "1px solid #334155", paddingTop: 8,
    display: "flex", flexDirection: "column", gap: 5,
    maxHeight: 120, overflowY: "auto",
  },
  historyLabel: { margin: 0, fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" },
  historyRow:   { display: "flex", justifyContent: "space-between", gap: 8 },
  historyText:  { fontSize: 11, color: "#64748b", wordBreak: "break-all" },
  historyTime:  { fontSize: 10, color: "#334155", flexShrink: 0 },
};