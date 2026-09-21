import React, { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

export default function AttachmentImage({ url, filename, onReady, onError }) {
  const viewport = useRef(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState("fit");
  const fitted = natural.width ? Math.min(1, size.width / natural.width, size.height / natural.height) : 1;
  const scale = zoom === "fit" ? fitted : zoom;

  useEffect(() => {
    const element = viewport.current;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  function changeZoom(next) {
    setZoom(next);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  return (
    <section className="w-attachment-image" aria-label="عرض الصورة الأصلية">
      <div className="w-attachment-image-controls">
        <button type="button" disabled={!natural.width || scale <= 0.1} aria-label="تصغير الصورة" onClick={() => changeZoom(Math.max(0.1, scale / 1.5))}><ZoomOut size={18} aria-hidden="true" /></button>
        <button type="button" aria-pressed={zoom === "fit"} onClick={() => changeZoom("fit")}>ملاءمة الشاشة</button>
        <button type="button" aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>الحجم الأصلي 100%</button>
        <button type="button" disabled={!natural.width || scale >= 4} aria-label="تكبير الصورة" onClick={() => changeZoom(Math.min(4, scale * 1.5))}><ZoomIn size={18} aria-hidden="true" /></button>
        {natural.width > 0 && <span role="status">{Math.round(scale * 100)}% <bdi>{natural.width} × {natural.height}</bdi> بكسل</span>}
      </div>
      <div className="w-attachment-image-viewport" ref={viewport} tabIndex={0} role="region" aria-label="الصورة قابلة للتمرير عند التكبير" dir="ltr">
        <div className="w-attachment-image-stage" style={natural.width ? { width: natural.width * scale, height: natural.height * scale } : undefined}>
          <img src={url} alt={filename || "مرفق الطلب"} draggable={false} referrerPolicy="no-referrer"
            style={natural.width ? { width: natural.width * scale, height: natural.height * scale } : undefined}
            onLoad={(event) => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); onReady(); }} onError={onError} />
        </div>
      </div>
    </section>
  );
}
