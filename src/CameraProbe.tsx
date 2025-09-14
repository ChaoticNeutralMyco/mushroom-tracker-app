import React, { useEffect, useRef, useState } from "react";

type Status = "idle" | "requesting" | "streaming" | "denied" | "error" | "unsupported";

const CameraProbe: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus("idle");
  };

  const probe = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("unsupported");
      setMessage("mediaDevices.getUserMedia is not available in this WebView.");
      return;
    }
    try {
      setStatus("requesting");
      setMessage("Requesting camera...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          /* ignore autoplay issues */
        }
      }

      setStatus("streaming");
      setMessage("Camera stream active.");

      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "videoinput"));
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      console.error("getUserMedia error:", err);
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setStatus("denied");
        setMessage("Permission denied. Grant camera permission in Android settings and try again.");
      } else {
        setStatus("error");
        setMessage(String(err));
      }
    }
  };

  useEffect(() => {
    probe();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle: React.CSSProperties = {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
  const videoStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 480,
    background: "#000",
    borderRadius: 8,
  };
  const badgeStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 999,
    alignSelf: "flex-start",
    border: "1px solid #ccc",
  };
  const rowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };

  return (
    <div style={containerStyle}>
      <h1>Camera Probe</h1>
      <div style={badgeStyle}>Status: {status}</div>
      {message && <div>{message}</div>}

      <video ref={videoRef} playsInline muted style={videoStyle} />

      <div style={rowStyle}>
        <button onClick={probe}>Request / Retry</button>
        <button onClick={stopStream}>Stop</button>
      </div>

      {devices.length > 0 && (
        <div>
          <h3>Video Inputs</h3>
          <ul>
            {devices.map((d) => (
              <li key={d.deviceId}>{d.label || "Camera"} ({d.deviceId.slice(0, 6)}…)</li>
            ))}
          </ul>
        </div>
      )}

      <p>
        Tip: In the Android emulator, the camera is virtual. In the emulator window use:
        More (⋮) → Camera → Virtual scene to see a test feed.
      </p>
    </div>
  );
};

export default CameraProbe;
