import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  GripVertical,
  Undo2,
  Upload,
  Save,
  Monitor,
  Smartphone,
} from "lucide-react";
import Studio from "../Studio";
import Workspace from "./Workspace";
import Admin from "./Admin";
import { supabase } from "../auth/supabase";
import { getEffectiveUser, uploadWithEffectiveAccess } from '../auth/impersonation';
import { allowed } from "../auth/account-rules";
import { usePlatform, platformError } from "./platform";
import "./preview.css";
import { SessionStateProvider, useSessionState } from '../shared/session-state';

export default function Editor() {
  const p=usePlatform();
  useEffect(()=>{if(p.authReady&&!p.can('content.edit'))window.location.replace('/login');},[p.authReady,p.user]);
  if(!p.authReady||!p.can('content.edit'))return <main className="a-loading" dir="rtl" role="status">{p.identityError?<div><p>{p.identityError}</p><button onClick={p.retryIdentity}>إعادة المحاولة</button></div>:'جار التحقق من صلاحية المحرر'}</main>;
  return <SessionStateProvider key={p.sessionScope} scope={p.sessionScope}><EditorSurface/></SessionStateProvider>;
}

function EditorSurface() {
  const p = usePlatform();
  const [surface, setSurface] = useSessionState('editor.surface',
      () => new URLSearchParams(location.search).get("surface") || "home",
    ),
    [mobile, setMobile] = useSessionState('editor.mobile',false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useSessionState('editor.history',[]),
    [elements, setElements] = useState([]);
  const canvas = useRef(null),
    drag = useRef(null);
  const selected = p.selection;
  const custom = p.config.elements?.[selected?.id] || {};
  useEffect(() => {
    let live = true;
    getEffectiveUser().then(({ data }) => {
      if (live && !allowed(data.user, "content.edit"))
        location.replace("/login");
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!canvas.current) return;
    setElements(
      [...canvas.current.querySelectorAll("[data-cms-id]")]
        .filter(
          (e) =>
            e.tagName === "SECTION" ||
            e.tagName === "ARTICLE" ||
            /(?:card|s-project$)/.test(e.className),
        )
        .map((e) => ({
          id: e.dataset.cmsId,
          label:
            (e.tagName === "DIV"
              ? "مجموعة البطاقات"
              : e.querySelector("h1,h2,h3")?.textContent) ||
            e.id ||
            e.textContent.slice(0, 45),
          tag: e.tagName.toLowerCase(),
        })),
    );
  }, [surface, p.config]);
  useEffect(() => {
    const guard = (e) => {
      if (p.draft) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [p.draft]);
  function change(next) {
    setHistory((h) => [...h.slice(-24), structuredClone(p.config)]);
    p.setDraft(next);
  }
  function patch(values) {
    if (selected)
      change({
        ...p.config,
        elements: {
          ...p.config.elements,
          [selected.id]: { ...custom, ...values },
        },
      });
  }
  async function publish(next = p.config) {
    setBusy(true);
    setMessage("");
    try {
      await p.save(next);
      setHistory([]);
      setMessage("تم النشر على المنصة");
    } catch (e) {
      setMessage(platformError(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(event, background = false) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || (!selected && !background)) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setMessage("اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 5 ميجابايت");
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const {
        data: { user },
      } = await getEffectiveUser();
      const path = `${user.id}/${crypto.randomUUID()}.${file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1]}`;
      const { error } = await uploadWithEffectiveAccess('platform-designs',path,file,{contentType:file.type,upsert:false});
      if (error) throw error;
      const url = supabase.storage.from("platform-designs").getPublicUrl(path)
        .data.publicUrl;
      const next = background
        ? { ...p.config, theme: { ...p.config.theme, backgroundImage: url } }
        : {
            ...p.config,
            elements: {
              ...p.config.elements,
              [selected.id]: {
                ...custom,
                [selected.tag === "img"
                  ? "image"
                  : selected.tag === "section"
                    ? "backdrop"
                    : "design"]: url,
              },
            },
          };
      change(next);
      await publish(next);
    } catch (e) {
      setMessage(platformError(e));
    } finally {
      setBusy(false);
    }
  }
  function move(sourceId, targetId) {
    const nodes = [...canvas.current.querySelectorAll("[data-cms-id]")];
    const source = nodes.find((e) => e.dataset.cmsId === sourceId),
      target = nodes.find((e) => e.dataset.cmsId === targetId);
    if (
      !source ||
      !target ||
      source === target ||
      source.parentElement !== target.parentElement
    ) {
      setMessage("حرك العنصر داخل مجموعته الحالية");
      return;
    }
    const siblings = [...source.parentElement.children]
      .filter((e) => e.dataset.cmsId)
      .sort(
        (a, b) =>
          (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0),
      );
    const from = siblings.indexOf(source),
      to = siblings.indexOf(target);
    siblings.splice(from, 1);
    siblings.splice(to, 0, source);
    const values = { ...p.config.elements };
    siblings.forEach((node, i) => {
      values[node.dataset.cmsId] = {
        ...values[node.dataset.cmsId],
        order: i + 1,
      };
    });
    change({ ...p.config, elements: values });
    setMessage("تم تغيير الترتيب انشر لاعتماده");
  }
  function step(offset) {
    if (!selected) return;
    const source = [...canvas.current.querySelectorAll("[data-cms-id]")].find(
      (e) => e.dataset.cmsId === selected.id,
    );
    if (!source) return;
    const siblings = [...source.parentElement.children]
      .filter((e) => e.dataset.cmsId)
      .sort(
        (a, b) =>
          (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0),
      );
    const target = siblings[siblings.indexOf(source) + offset];
    if (target) move(selected.id, target.dataset.cmsId);
  }
  if (!p.can("content.edit"))
    return <div className="a-loading">جار التحقق من صلاحية الإدارة</div>;
  return (
    <div className="a-editor" dir="rtl">
      <header className="a-editor-top">
        <a href="/admin/dashboard">العودة للإدارة</a>
        <strong>المحرر المباشر</strong>
        <span>{p.draft ? "تعديلات غير منشورة" : "كل التعديلات محفوظة"}</span>
        <button
          disabled={!history.length || busy}
          onClick={() => {
            p.setDraft(history.at(-1));
            setHistory((h) => h.slice(0, -1));
          }}
        >
          <Undo2 size={17} />
          تراجع
        </button>
        <button
          className="a-primary"
          disabled={busy || !p.draft}
          onClick={() => publish()}
        >
          <Save size={17} />
          {busy ? "جار الحفظ" : "نشر التعديلات"}
        </button>
      </header>
      <aside className="a-inspector">
        <label>
          المساحة
          <select
            value={surface}
            onChange={(e) => {
              setSurface(e.target.value);
              p.setSelection(null);
            }}
          >
            <option value="home">الموقع الرئيسي</option>
            <option value="client">لوحة العميل</option>
            <option value="employee">لوحة الموظف</option>
            <option value="admin">لوحة الأدمن</option>
            <option value="super_admin">لوحة السوبر أدمن</option>
          </select>
        </label>
        <div className="a-actions">
          <button aria-pressed={!mobile} onClick={() => setMobile(false)}>
            <Monitor size={18} />
            كمبيوتر
          </button>
          <button aria-pressed={mobile} onClick={() => setMobile(true)}>
            <Smartphone size={18} />
            جوال
          </button>
        </div>
        <p>اختر عنصرا من الصفحة لتعديله واسحب البطاقات لتغيير ترتيبها</p>
        {message && (
          <p className="a-notice" role="status">
            {message}
          </p>
        )}
        {selected && (
          <button
            disabled={busy}
            onClick={() => {
              const values = { ...p.config.elements };
              delete values[selected.id];
              change({ ...p.config, elements: values });
              p.setSelection(null);
            }}
          >
            استعادة العنصر الأصلي
          </button>
        )}
        <fieldset disabled={busy}>
          <legend>العنصر المحدد</legend>
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              {selected.text !== undefined && (
                <label>
                  النص
                  <textarea
                    maxLength={5000}
                    value={custom.text ?? selected.text}
                    onChange={(e) => patch({ text: e.target.value })}
                  />
                </label>
              )}
              <label className="a-toggle">
                <input
                  type="checkbox"
                  checked={!custom.hidden}
                  onChange={(e) => patch({ hidden: !e.target.checked })}
                />
                إظهار العنصر
              </label>
              <div className="a-colors">
                <label>
                  لون النص
                  <input
                    type="color"
                    value={custom.color || "#f4f2f2"}
                    onChange={(e) => patch({ color: e.target.value })}
                  />
                </label>
                <label>
                  لون الخلفية
                  <input
                    type="color"
                    value={custom.background || "#171414"}
                    onChange={(e) => patch({ background: e.target.value })}
                  />
                </label>
              </div>
              <label className="a-upload">
                <Upload size={18} />
                رفع تصميم واعتماده مباشرة
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={upload}
                />
              </label>
              <label>
                عدد الأعمدة
                <select
                  value={custom.columns || ""}
                  onChange={(e) =>
                    patch({
                      columns: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">التوزيع الأصلي</option>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                المسافة بين العناصر
                <input
                  type="range"
                  min="0"
                  max="80"
                  value={custom.gap ?? 20}
                  onChange={(e) => patch({ gap: Number(e.target.value) })}
                />
              </label>
              {(custom.design || custom.image) && (
                <button onClick={() => patch({ design: null, image: null })}>
                  استعادة التصميم الأصلي
                </button>
              )}
              <div className="a-actions">
                <button onClick={() => step(-1)}>
                  <ArrowUp size={17} />
                  تقديم
                </button>
                <button onClick={() => step(1)}>
                  <ArrowDown size={17} />
                  تأخير
                </button>
              </div>
            </>
          ) : (
            <p>اضغط على النص أو الصورة أو اختر بطاقة من القائمة</p>
          )}
        </fieldset>
        <details>
          <summary>الأقسام والبطاقات</summary>
          <div className="a-element-list">
            {elements.map((el, i) => (
              <button
                key={`${el.id}-${i}`}
                draggable
                onDragStart={() => {
                  drag.current = el.id;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  move(drag.current, el.id);
                }}
                onClick={() => p.setSelection(el)}
                aria-pressed={selected?.id === el.id}
              >
                <GripVertical size={16} />
                {el.label || "بطاقة"}
                {p.config.elements?.[el.id]?.hidden ? " مخفي" : ""}
              </button>
            ))}
          </div>
        </details>
        {p.can("appearance.edit") && (
          <details>
            <summary>الخلفية العامة</summary>
            <label className="a-upload">
              رفع خلفية واعتمادها
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => upload(e, true)}
              />
            </label>
            <button
              onClick={() =>
                change({
                  ...p.config,
                  theme: { ...p.config.theme, backgroundImage: null },
                })
              }
            >
              استعادة الخلفية الأصلية
            </button>
          </details>
        )}
        <button
          disabled={busy}
          onClick={() => {
            p.setDraft(null);
            setHistory([]);
            p.refresh().catch((e) => setMessage(platformError(e)));
          }}
        >
          إلغاء التعديلات وإعادة التحميل
        </button>
      </aside>
      <div
        ref={canvas}
        onClickCapture={(e) => {
          if (e.target.closest("a")) e.preventDefault();
        }}
        onSubmitCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className={`a-canvas ${mobile ? "a-canvas-mobile" : ""}`}
        onDragStart={(e) => {
          const node = e.target.closest('[draggable="true"][data-cms-id]');
          if (node) drag.current = node.dataset.cmsId;
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const node = e.target.closest('[draggable="true"][data-cms-id]');
          if (node) move(drag.current, node.dataset.cmsId);
        }}
      >
        <SessionStateProvider disabled>{surface === "home" ? (
          <Studio />
        ) : surface === "super_admin" ? (
          <Admin account={{ user: { email: "", id: "" } }} preview />
        ) : (
          <Workspace role={surface} preview />
        )}</SessionStateProvider>
      </div>
    </div>
  );
}
