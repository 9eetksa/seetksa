import React, {useEffect, useRef, useState} from 'react';
import {Pause, Play} from 'lucide-react';
import {mountPartnerReel} from './partner-reel';

// Same complete collection as the preserved main site.
const whiteLogos = new Set([6,7,12,13,14,18,19,22,24,26,27,28,30,40,44,48,50,52,54,56,57,61,62]);
const portraitLogos = new Set([1,3,8,10,11,12,14,21,25,28,29,34,39,40,42,43,50,53,54,57,61,63,65,66]);
const names = {1:'Veranda Specialty Coffee',2:'ساسنا العربية',3:'رشفة',4:'ترحاب',5:'جبّار',6:'هيئة تطوير منطقة عسير',7:'فريزي',8:'المديرية العامة لمكافحة المخدرات',9:'MBC',10:'المعهد الملكي للفنون التقليدية',11:'وزارة الحج والعمرة'};
const partners = Array.from({length:66}, (_, index) => {
  const id = index + 1;
  return [id, names[id] || `شعار الشريك ${id} من شركاء صيت`, portraitLogos.has(id) ? 'portrait' : 'wide'];
});

export default function CinemaPartners() {
  const reel = useRef(null), pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  pausedRef.current = paused;
  useEffect(() => mountPartnerReel(reel.current, () => pausedRef.current), []);
  return <section className="c-partners" id="partners" aria-labelledby="partners-title">
    <div className="c-partners-heading"><div><span className="c-eyebrow">ثقة نعتز بها</span><h2 id="partners-title">شركاء النجاح</h2></div>
      <button type="button" className="c-partners-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? 'تشغيل حركة الشعارات' : 'إيقاف حركة الشعارات'} aria-pressed={paused} aria-controls="partner-reel">{paused ? <Play size={16}/> : <Pause size={16}/>}</button>
    </div>
    <div className="c-partners-reel" id="partner-reel" ref={reel} style={{'--partner-count':partners.length}} dir="ltr" tabIndex={0} role="region" aria-label="شعارات الشركاء — اسحب يمينًا ويسارًا أو استخدم مفاتيح الأسهم">
      {[0,1,2].map(copy => <ul className="c-partners-list" key={copy} aria-hidden={copy !== 1 ? true : undefined}>
        {partners.map(([id,name,shape]) => <li className={`c-partner c-partner-${shape}`} key={id}>
          <div className="c-partner-mark"><img src={`/brand/official/partners/${id}.webp`} className={whiteLogos.has(id) ? 'c-invert' : undefined} alt={copy === 1 ? name : ''} loading="lazy" decoding="async" draggable={false}/></div>
        </li>)}
      </ul>)}
    </div>
  </section>;
}
