import {useEffect, useRef, useState} from 'react';

export default function useHeroFilm() {
  const ref = useRef(null), desired = useRef(null), syncRef = useRef(() => {});
  const [playing,setPlaying] = useState(false), [failed,setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current, motion = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false, disposed = false;
    const sync = () => {
      if (visible && !document.hidden && (desired.current ?? !motion.matches)) {
        video.play().catch(() => { if (!disposed) setPlaying(false); });
      } else video.pause();
    };
    syncRef.current = sync;
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false);
    const onError = () => {setFailed(true);setPlaying(false);};
    const observer = new IntersectionObserver(([entry]) => {visible=entry.isIntersecting;sync();});
    observer.observe(video);
    video.addEventListener('play',onPlay);
    video.addEventListener('pause',onPause);
    video.addEventListener('error',onError);
    document.addEventListener('visibilitychange',sync);
    motion.addEventListener('change',sync);
    return () => {
      disposed=true; observer.disconnect(); syncRef.current=()=>{};
      video.removeEventListener('play',onPlay); video.removeEventListener('pause',onPause); video.removeEventListener('error',onError);
      document.removeEventListener('visibilitychange',sync); motion.removeEventListener('change',sync); video.pause();
    };
  },[]);
  return {ref,playing,failed,toggle:() => {desired.current=!playing;syncRef.current();}};
}
