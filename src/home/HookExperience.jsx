import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowDown, Pause, Play, RotateCcw, X} from 'lucide-react';
import {useCmsTree} from '../admin/platform';
import './hook-experience.css';

const messageNamespace = 'pv-reference';

export default function HookExperience({onExit} = {}) {
  const cms = useCmsTree('home-hook');
  const root = useRef(null);
  const frame = useRef(null);
  const inView = useRef(true);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const initialPaused = useRef(reduced);
  const motionPaused = paused || reduced;
  const motion = useRef(motionPaused);
  motion.current = motionPaused;

  const send = useCallback((type, payload = {}) => {
    frame.current?.contentWindow?.postMessage(
      {namespace: messageNamespace, type, ...payload},
      window.location.origin,
    );
  }, []);

  const syncMotion = useCallback(() => {
    send('pause', {paused: motion.current || document.hidden || !inView.current});
  }, [send]);

  const exit = useCallback(() => {
    if (onExit) onExit();
    else window.location.assign('/home');
  }, [onExit]);

  useEffect(() => {
    if (!onExit) return;
    const iframe = frame.current;
    let contentWindow;
    const onKeyUp = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exit();
    };
    const attach = () => {
      contentWindow?.removeEventListener('keyup', onKeyUp, true);
      contentWindow = iframe.contentWindow;
      contentWindow?.addEventListener('keyup', onKeyUp, true);
    };
    iframe.addEventListener('load', attach);
    attach();
    return () => {
      iframe.removeEventListener('load', attach);
      contentWindow?.removeEventListener('keyup', onKeyUp, true);
    };
  }, [attempt, exit, onExit]);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || message.namespace !== messageNamespace) return;
      if (message.type === 'ready') {
        setStatus('ready');
        syncMotion();
      } else if (message.type === 'error') {
        setStatus('error');
      } else if (message.type === 'exit') {
        exit();
      } else if (message.type === 'replay') {
        initialPaused.current = motion.current;
        setStatus('loading');
        setAttempt((current) => current + 1);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [exit, syncMotion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setStatus((current) => current === 'loading' ? 'error' : current);
    }, 60000);
    return () => window.clearTimeout(timeout);
  }, [attempt]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      syncMotion();
    });
    observer.observe(root.current);
    document.addEventListener('visibilitychange', syncMotion);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncMotion);
    };
  }, [syncMotion]);

  useEffect(syncMotion, [motionPaused, syncMotion]);

  function retry() {
    initialPaused.current = motion.current;
    setStatus('loading');
    setAttempt((current) => current + 1);
  }

  function replay() {
    retry();
  }

  return cms(
    <section
      className="pv-hook"
      id={onExit ? undefined : 'home'}
      ref={root}
      aria-label="رحلة صيت الإبداعية"
      data-state={status}
      data-paused={motionPaused}
    >
      <iframe
        key={attempt}
        className="pv-hook-frame"
        ref={frame}
        src={`/scenes/reference/index.html?paused=${initialPaused.current ? '1' : '0'}`}
        title="رحلة صيت التفاعلية"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        tabIndex={status === 'ready' ? 0 : -1}
        onLoad={syncMotion}
        onError={() => setStatus('error')}
      />
      {status !== 'ready' && (
        <div className="pv-hook-fallback">
          <img src="/scenes/reference/assets/textures/frost.webp" alt="" />
          <div className="pv-hook-status" role="status" aria-live="polite">
            <p>{status === 'error' ? 'تعذر تشغيل المشهد على هذا الجهاز' : 'جار تحميل الرحلة'}</p>
            {status === 'error' && (
              <>
                <p>أعد المحاولة أو تابع إلى موقع صيت</p>
                <button type="button" onClick={retry}>أعد المحاولة <RotateCcw size={16} aria-hidden="true" /></button>
              </>
            )}
          </div>
        </div>
      )}
      <nav className="pv-hook-controls" aria-label="التحكم في الرحلة">
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          aria-label={motionPaused ? 'تشغيل الحركة' : 'إيقاف الحركة'}
          aria-pressed={motionPaused}
          aria-describedby={reduced ? 'pv-hook-motion-note' : undefined}
          disabled={reduced || status !== 'ready'}
        >
          {motionPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          <span>{motionPaused ? 'تشغيل' : 'إيقاف'}</span>
        </button>
        <button type="button" onClick={replay} disabled={status !== 'ready'} aria-label="إعادة الرحلة">
          <RotateCcw size={16} aria-hidden="true" /><span>إعادة</span>
        </button>
        {onExit ? (
          <button type="button" onClick={exit} autoFocus aria-label="إغلاق القصة">
            إغلاق القصة <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <a href="/home">تخطّ الرحلة <ArrowDown size={16} aria-hidden="true" /></a>
        )}
      </nav>
      {reduced && <p className="pv-hook-sr-only" id="pv-hook-motion-note">الحركة متوقفة حسب إعداد تقليل الحركة في جهازك</p>}
    </section>,
  );
}
