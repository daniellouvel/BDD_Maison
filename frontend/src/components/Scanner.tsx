import jsQR from "jsqr";
import { FormEvent, useEffect, useRef, useState } from "react";
import { extractCode } from "../qr";

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const SCAN_INTERVAL_MS = 200;
const SAME_CODE_DELAY_MS = 2500;
const MAX_FRAME_WIDTH = 720;

/**
 * Lecteur de QR par la caméra arrière, avec saisie manuelle en secours.
 * Utilise l'API native BarcodeDetector (Chrome Android) et jsQR ailleurs.
 */
export default function Scanner({ onCode, hint }: { onCode: (code: string) => void; hint?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.isSecureContext) {
      setCameraError("La caméra nécessite une connexion HTTPS. Saisissez le code ci-dessous.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Ce navigateur ne donne pas accès à la caméra. Saisissez le code ci-dessous.");
      return;
    }

    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let busy = false;
    let stopped = false;
    let last = { code: "", at: 0 };
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;

    const found = (text: string) => {
      const code = extractCode(text);
      if (!code) return;
      const now = Date.now();
      if (code === last.code && now - last.at < SAME_CODE_DELAY_MS) return;
      last = { code, at: now };
      navigator.vibrate?.(60);
      onCodeRef.current(code);
    };

    const tick = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (busy || stopped || !video || !canvas || video.readyState < 2) return;
      busy = true;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes[0]) found(codes[0].rawValue);
        } else {
          const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
            if (result) found(result.data);
          }
        }
      } catch {
        // image momentanément indisponible : on réessaie au tour suivant
      } finally {
        busy = false;
      }
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        video.play().catch(() => undefined);
        timer = window.setInterval(tick, SCAN_INTERVAL_MS);
      })
      .catch((err: DOMException) => {
        setCameraError(
          err.name === "NotAllowedError"
            ? "Accès à la caméra refusé. Autorisez-le dans le navigateur ou saisissez le code."
            : "Aucune caméra disponible. Saisissez le code ci-dessous.",
        );
      });

    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const raw = manual.trim();
    const code = /^\d{1,6}$/.test(raw) && Number(raw) > 0 ? `QR-${raw.padStart(6, "0")}` : extractCode(raw);
    if (!code) {
      setManualError("Format attendu : QR-000123 (ou simplement 123).");
      return;
    }
    setManualError(null);
    setManual("");
    onCodeRef.current(code);
  }

  return (
    <div className="scanner">
      {hint && <p className="scanner-hint">{hint}</p>}
      {cameraError ? (
        <p className="muted">{cameraError}</p>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame" aria-hidden="true" />
        </div>
      )}
      <canvas ref={canvasRef} hidden />
      <form className="searchbar" onSubmit={submitManual}>
        <input
          placeholder="Ou saisir le code : QR-000123"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          aria-label="Code de l'étiquette"
        />
        <button type="submit">OK</button>
      </form>
      {manualError && <p className="error">{manualError}</p>}
    </div>
  );
}
