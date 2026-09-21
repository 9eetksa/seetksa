import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import { repository } from "./data";
import { saveOriginal } from "./attachment-files";
import AttachmentImage from "./AttachmentImage";
import "./attachment-preview.css";

function previewKind(file) {
  const extension = String(file.filename || "").split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "ico"].includes(extension))
    return "image";
  if (["mp4", "m4v", "mov", "webm", "ogv"].includes(extension)) return "video";
  if (["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"].includes(extension))
    return "audio";
  if (extension === "pdf") return "pdf";
  return null;
}

export default function AttachmentPreview({ file, onClose, resolvePreview = repository.preview, downloadOriginal = saveOriginal }) {
  const dialog = useRef(null);
  const latestFile = useRef(file);
  const alive = useRef(false);
  const downloading = useRef(false);
  latestFile.current = file;
  const kind = previewKind(file);
  const supported = !!kind;
  const sourceKey = JSON.stringify([file.object_path, file.id, file.filename, kind]);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState({ key: sourceKey, url: "", status: "loading" });
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const current = preview.key === sourceKey ? preview : { url: "", status: "loading" };

  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement;
    const modal = dialog.current;
    if (!modal.open) modal.showModal();
    return () => {
      alive.current = false;
      modal.close();
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDownloadError("");
    setPreview({ key: sourceKey, url: "", status: supported ? "loading" : "unsupported" });
    if (supported) {
      Promise.all([
        resolvePreview(latestFile.current),
        kind === "pdf" ? import("./AttachmentPdf") : Promise.resolve(null),
      ]).then(
        ([url, pdf]) => {
          if (!cancelled) setPreview({ key: sourceKey, url: url || "", Pdf: pdf?.default, status: url ? "loading" : "error" });
        },
        () => {
          if (!cancelled) setPreview({ key: sourceKey, url: "", status: "error" });
        },
      );
    }
    // Signed URLs need no object URL revocation and late responses are discarded
    return () => { cancelled = true; };
  }, [sourceKey, supported, kind, attempt, resolvePreview]);

  const mediaReady = useCallback(() => {
    setPreview((value) => value.key === sourceKey ? { ...value, status: "ready" } : value);
  }, [sourceKey]);

  const mediaFailed = useCallback((message) => {
    setPreview((value) => value.key === sourceKey ? { ...value, url: "", status: "error", message: typeof message === "string" ? message : "" } : value);
  }, [sourceKey]);

  async function handleDownloadOriginal() {
    if (downloading.current) return;
    downloading.current = true;
    setDownloadBusy(true);
    setDownloadError("");
    const requestedFile = latestFile.current;
    try {
      await downloadOriginal(requestedFile);
    } catch {
      if (alive.current && latestFile.current.object_path === requestedFile.object_path)
        setDownloadError("تعذر تحميل الملف الأصلي حاول مرة أخرى");
    } finally {
      downloading.current = false;
      if (alive.current) setDownloadBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="w-attachment-preview"
      dir="rtl"
      aria-labelledby="attachment-preview-title"
      aria-describedby="attachment-preview-filename"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header className="w-attachment-preview-header">
        <div>
          <h2 id="attachment-preview-title">معاينة المرفق</h2>
          <p id="attachment-preview-filename" dir="auto">{file.filename || "مرفق الطلب"}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="إغلاق معاينة المرفق" autoFocus>
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <div className={`w-attachment-preview-content is-${kind || "unsupported"}`}>
        {!supported ? (
          <div className="w-attachment-preview-state">
            <FileText size={32} aria-hidden="true" />
            <p>المعاينة غير متاحة لهذا النوع من الملفات</p>
            <p>يمكنك تحميل الملف الأصلي وفتحه على جهازك</p>
          </div>
        ) : current.status === "error" ? (
          <div className="w-attachment-preview-state">
            <p role="alert">{current.message || "تعذر عرض المعاينة يمكنك إعادة المحاولة أو تحميل الملف الأصلي"}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RotateCcw size={18} aria-hidden="true" />
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <>
            {current.status === "loading" && (
              <p className="w-attachment-preview-loading" role="status">
                <LoaderCircle size={20} aria-hidden="true" />
                جار تحميل المعاينة
              </p>
            )}
            {current.url && kind === "image" && (
              <AttachmentImage key={current.url} url={current.url} filename={file.filename} onReady={mediaReady} onError={mediaFailed} />
            )}
            {current.url && kind === "video" && (
              <video key={current.url} src={current.url} controls playsInline preload="metadata" onLoadedMetadata={mediaReady} onError={mediaFailed}>
                المتصفح لا يدعم معاينة الفيديو يمكنك تحميل الملف الأصلي
              </video>
            )}
            {current.url && kind === "audio" && (
              <audio key={current.url} src={current.url} controls preload="metadata" onLoadedMetadata={mediaReady} onError={mediaFailed}>
                المتصفح لا يدعم معاينة الصوت يمكنك تحميل الملف الأصلي
              </audio>
            )}
            {current.url && kind === "pdf" && current.Pdf && (
              <current.Pdf key={current.url} url={current.url} onReady={mediaReady} onError={mediaFailed}/>
            )}
          </>
        )}
      </div>

      <footer className="w-attachment-preview-footer">
        {downloadError && <p role="alert">{downloadError}</p>}
        <button type="button" className="w-attachment-preview-download" disabled={downloadBusy} onClick={handleDownloadOriginal}>
          {downloadBusy ? <LoaderCircle size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
          {downloadBusy ? "جار تجهيز التحميل" : "تحميل الملف الأصلي"}
        </button>
      </footer>
    </dialog>
  );
}
