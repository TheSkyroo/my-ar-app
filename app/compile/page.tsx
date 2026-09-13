"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// MindAR's image-target compiler build. Runs entirely in the browser
// (TensorFlow.js) — no native modules, so it works on any machine and on Vercel.
const COMPILER_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

type MindCompiler = {
  compileImageTargets: (
    images: HTMLImageElement[],
    onProgress: (progress: number) => void
  ) => Promise<unknown>;
  exportData: () => Promise<ArrayBuffer | Uint8Array>;
};

declare global {
  interface Window {
    MINDAR?: { IMAGE?: { Compiler: new () => MindCompiler } };
  }
}

function loadCompiler(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.MINDAR?.IMAGE?.Compiler) return resolve();
    const existing = document.getElementById("mindar-compiler");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }
    const s = document.createElement("script");
    s.id = "mindar-compiler";
    s.type = "module"; // this build is an ES module that sets window.MINDAR
    s.src = COMPILER_SRC;
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("load failed")));
    document.head.appendChild(s);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export default function CompilePage() {
  const [preview, setPreview] = useState<string>("/targets/card.png");
  const [status, setStatus] = useState<"idle" | "compiling" | "done" | "error">(
    "idle"
  );
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const imgSrcRef = useRef<string>("/targets/card.png");

  useEffect(() => {
    loadCompiler().catch(() =>
      setMessage("Could not load the compiler. Check your connection.")
    );
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    imgSrcRef.current = url;
    setPreview(url);
    setStatus("idle");
    setMessage("");
  }, []);

  const compile = useCallback(async () => {
    setStatus("compiling");
    setProgress(0);
    setMessage("");
    try {
      await loadCompiler();
      const Compiler = window.MINDAR?.IMAGE?.Compiler;
      if (!Compiler) throw new Error("Compiler unavailable");

      const img = await loadImage(imgSrcRef.current);
      const compiler = new Compiler();
      await compiler.compileImageTargets([img], (p: number) =>
        setProgress(Math.round(p))
      );
      const buffer = await compiler.exportData();
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

      const blob = new Blob([bytes as BlobPart], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "card.mind";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage(
        "Compiling failed. Try a smaller image (under ~1200px wide) and retry."
      );
    }
  }, []);

  return (
    <main className="home">
      <div className="home-card">
        <span className="badge">Target Compiler</span>
        <h1>Make a .mind target</h1>
        <p className="lead">
          Turn any image into a tracking target. Your current card is preloaded —
          just tap <strong>Compile</strong>, then drop the downloaded{" "}
          <code>card.mind</code> into <code>public/targets/</code>.
        </p>

        <div className="compile-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="target preview" />
        </div>

        <label className="file-label">
          Choose a different image
          <input type="file" accept="image/*" onChange={onFile} hidden />
        </label>

        {status === "compiling" && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
            <span className="progress-text">Compiling… {progress}%</span>
          </div>
        )}

        {status === "done" && (
          <p className="ok-text">
            ✅ Downloaded <code>card.mind</code>. Move it into{" "}
            <code>public/targets/</code> (replace the old one), then restart /
            redeploy. Your AR page will now track this image.
          </p>
        )}

        {message && <p className="err-text">{message}</p>}

        <button
          className="cta"
          onClick={compile}
          disabled={status === "compiling"}
        >
          {status === "compiling" ? "Compiling…" : "Compile → download card.mind"}
        </button>

        <p className="note" style={{ marginTop: 20 }}>
          <Link href="/" className="target-dl">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
