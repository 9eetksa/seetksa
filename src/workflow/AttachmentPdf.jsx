import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AnnotationMode, getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./attachment-pdf.css";

GlobalWorkerOptions.workerSrc = workerUrl;
const assets = `${import.meta.env.BASE_URL}pdfjs/5.5.207/`;
const number = new Intl.NumberFormat("ar-SA", { useGrouping: false });
const maxCanvasPixels = 8 * 1024 * 1024;
const maxCanvasSide = 4096;

export default function AttachmentPdf({ url, onReady, onError }) {
  const viewport = useRef(null);
  const canvas = useRef(null);
  const stage = useRef(null);
  const activeRender = useRef(null);
  const [documentState, setDocumentState] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState("fit");
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [pageText, setPageText] = useState("");
  const pdf = documentState?.url === url ? documentState.document : null;
  const pageCount = pdf?.numPages || 0;

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    setDocumentState(null);
    setPageNumber(1);
    setZoom("fit");
    setError("");
    setRendering(true);
    function failed(reason) {
      if (cancelled) return;
      const message = reason?.name === "PasswordException"
        ? "هذا المستند محمي بكلمة مرور يمكنك تحميل الملف الأصلي وفتحه على جهازك"
        : "تعذر عرض المستند يمكنك تحميل الملف الأصلي";
      setError(message);
      setRendering(false);
      onError(message);
    }
    try {
      loadingTask = getDocument({
        url,
        withCredentials: false,
        isEvalSupported: false,
        enableXfa: false,
        disableAutoFetch: true,
        disableStream: true,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        iccUrl: `${assets}iccs/`,
        verbosity: 0,
      });
      // No password callback means protected documents reject instead of waiting
      loadingTask.promise.then((document) => {
        if (!cancelled) setDocumentState({ url, document });
      }, failed);
    } catch (reason) {
      failed(reason);
    }
    return () => {
      cancelled = true;
      const renderingTask = activeRender.current;
      renderingTask?.cancel();
      // Settle canvas work before aborting requests and destroying the worker
      Promise.resolve(renderingTask?.promise).catch(() => {}).finally(() => loadingTask?.destroy().catch(() => {}));
    };
  }, [url, onError]);

  useEffect(() => {
    const element = viewport.current;
    function measure() {
      const rect = element.getBoundingClientRect();
      const next = {
        width: Math.max(0, Math.floor(element.clientWidth || rect.width)),
        height: Math.max(0, Math.floor(element.clientHeight || rect.height)),
        dpr: Math.max(1, window.devicePixelRatio || 1),
      };
      setSize((previous) => previous.width === next.width && previous.height === next.height && previous.dpr === next.dpr ? previous : next);
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0, left: 0 });
    setScroll({ x: 0, y: 0 });
  }, [pageNumber, zoom]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setPageText("");
    pdf.getPage(pageNumber).then((page) => page.getTextContent()).then((content) => {
      if (!cancelled) setPageText(content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdf, pageNumber]);

  useEffect(() => {
    if (!pdf || !size.width || !size.height || !canvas.current) return;
    let cancelled = false;
    let renderTask;
    let pdfPage;
    const target = canvas.current;
    setRendering(true);
    setError("");
    async function renderPage() {
      try {
        pdfPage = await pdf.getPage(pageNumber);
        if (cancelled) { pdfPage.cleanup(); return; }
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = zoom === "fit" ? Math.min(size.width / base.width, size.height / base.height) : Number(zoom) * 96 / 72;
        const pageViewport = pdfPage.getViewport({ scale });
        // Render the visible page region at its selected scale rather than
        // stretching a reduced full-page bitmap when a large page is zoomed
        const x = Math.min(Math.max(0, scroll.x - 128), Math.max(0, pageViewport.width - 1));
        const y = Math.min(Math.max(0, scroll.y - 128), Math.max(0, pageViewport.height - 1));
        const width = Math.min(pageViewport.width - x, size.width + 384);
        const height = Math.min(pageViewport.height - y, size.height + 384);
        stage.current.style.width = `${pageViewport.width}px`;
        stage.current.style.height = `${pageViewport.height}px`;
        const outputScale = Math.min(
          size.dpr,
          maxCanvasSide / width,
          maxCanvasSide / height,
          Math.sqrt(maxCanvasPixels / (width * height)),
        );
        target.width = Math.max(1, Math.ceil(width * outputScale));
        target.height = Math.max(1, Math.ceil(height * outputScale));
        target.style.width = `${width}px`;
        target.style.height = `${height}px`;
        target.style.left = `${x}px`;
        target.style.top = `${y}px`;
        renderTask = pdfPage.render({
          canvas: target,
          viewport: pageViewport,
          transform: [outputScale, 0, 0, outputScale, -x * outputScale, -y * outputScale],
          annotationMode: AnnotationMode.ENABLE,
          background: "#ffffff",
        });
        activeRender.current = renderTask;
        await renderTask.promise;
        if (!cancelled) {
          setRendering(false);
          onReady();
        }
      } catch (reason) {
        if (!cancelled && reason?.name !== "RenderingCancelledException") {
          setError("تعذر عرض هذه الصفحة يمكنك تحميل الملف الأصلي");
          setRendering(false);
          onError("تعذر عرض هذه الصفحة يمكنك تحميل الملف الأصلي");
        }
      }
    }
    renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      if (activeRender.current === renderTask) activeRender.current = null;
      if (renderTask) renderTask.promise.catch(() => {}).finally(() => pdfPage?.cleanup());
      else pdfPage?.cleanup();
    };
  }, [pdf, pageNumber, size, zoom, scroll, onReady, onError]);

  return (
    <section className="w-attachment-pdf" aria-label="صفحات المستند">
      <div className="w-attachment-pdf-controls">
        <button type="button" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}>
          <ArrowRight size={18} aria-hidden="true" />
          السابق
        </button>
        <span role="status" aria-live="polite">
          {pageCount ? `الصفحة ${number.format(pageNumber)} من ${number.format(pageCount)}` : "جار فتح المستند"}
        </span>
        <button type="button" disabled={!pdf || pageNumber >= pageCount} onClick={() => setPageNumber((page) => page + 1)}>
          التالي
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="w-attachment-pdf-options">
        <label>تكبير المستند<select value={zoom} onChange={(event) => setZoom(event.target.value)} disabled={!pdf}>
          <option value="fit">ملاءمة الشاشة</option>
          {[0.5, 1, 1.5, 2, 3, 4].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
        </select></label>
        <label>الانتقال إلى الصفحة<input type="number" min={1} max={pageCount || 1} value={pageNumber} disabled={!pdf} onChange={(event) => {
          const page = Number(event.target.value);
          if (Number.isInteger(page) && page >= 1 && page <= pageCount) setPageNumber(page);
        }} /></label>
      </div>
      <div className="w-attachment-pdf-page" ref={viewport} aria-busy={rendering} tabIndex={0} role="region" aria-label="صفحة المستند قابلة للتمرير عند التكبير" dir="ltr" onScroll={(event) => {
        const next = { x: Math.floor(event.currentTarget.scrollLeft / 128) * 128, y: Math.floor(event.currentTarget.scrollTop / 128) * 128 };
        setScroll((previous) => previous.x === next.x && previous.y === next.y ? previous : next);
      }}>
        {error ? <p role="alert">{error}</p> : (
          <>
            <div className="w-attachment-pdf-stage" ref={stage}><canvas
              key={`${url}:${pageNumber}:${size.width}:${size.height}:${size.dpr}:${zoom}:${scroll.x}:${scroll.y}`}
              ref={canvas}
              role="img"
              aria-label={`الصفحة ${number.format(pageNumber)} من المستند`}
              className={rendering ? "is-rendering" : undefined}
            >
              يمكنك تحميل الملف الأصلي لقراءة المستند
            </canvas></div>
            {rendering && <p className="w-attachment-pdf-loading" role="status">جار عرض الصفحة</p>}
          </>
        )}
      </div>
      <details className="w-attachment-pdf-text">
        <summary>قراءة نص الصفحة</summary>
        <p dir="auto">{pageText.trim() || "لا يتوفر نص قابل للاستخراج من هذه الصفحة يمكنك عرضها أو تحميل المستند الأصلي"}</p>
      </details>
    </section>
  );
}

