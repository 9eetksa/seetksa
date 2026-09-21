import React, { useState } from 'react';
import { Pause, Play } from 'lucide-react';

// Official networkSection: 66 assets, four consecutive rows, 50s per loop.
const whiteLogos = new Set([6, 7, 12, 13, 14, 18, 19, 22, 24, 26, 27, 28, 30, 40, 44, 48, 50, 52, 54, 56, 57, 61, 62]);
const names = {
  1: 'Veranda Specialty Coffee', 2: 'ساسنا العربية', 3: 'رشفة',
  4: 'ترحاب', 5: 'جبّار', 6: 'هيئة تطوير منطقة عسير', 7: 'فريزي',
  8: 'المديرية العامة لمكافحة المخدرات', 9: 'MBC',
  10: 'المعهد الملكي للفنون التقليدية', 11: 'وزارة الحج والعمرة',
};
const rows = Array.from({ length: 4 }, (_, row) =>
  Array.from({ length: Math.min(17, 66 - row * 17) }, (_, index) => row * 17 + index + 1),
);

export default function Partners() {
  const [paused, setPaused] = useState(false);

  return (
    <section className="seet-partners" id="partners" aria-labelledby="partners-title" data-paused={paused}>
      <div className="s-container">
        <div className="seet-partners-heading">
          <h2 id="partners-title">شركاء النجاح</h2>
          <p>نعتز بثقة شركائنا وبكل تجربة شاركنا في صناعتها معهم<br />من بداية الفكرة إلى اللحظة التي يترك فيها العمل أثره</p>
        </div>
        <div className="seet-partners-rows">
          {rows.map((row, index) => (
            <div className="seet-partners-row" key={index} tabIndex={0} role="region" aria-label={`شعارات شركاء النجاح — الصف ${index + 1}`}>
              <div className="seet-partners-track" style={{ animationDirection: index % 2 ? 'reverse' : 'normal' }}>
                {[0, 1].map((copy) => (
                  <ul className="seet-partners-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                    {row.map((id) => (
                      <li key={id}>
                        <img
                          src={`/brand/official/partners/${id}.webp`}
                          alt={copy === 1 ? '' : names[id] || `شعار الشريك ${id} من شركاء صيت`}
                          className={whiteLogos.has(id) ? 'seet-partner-inverted' : undefined}
                          width="256"
                          height="110"
                          loading="lazy"
                          decoding="async"
                        />
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="seet-partners-foot">
          <p>نصنع مع شركائنا قصصًا تستحق أن تُروى وصيتًا يستحق أن يبقى</p>
          <button type="button" className="seet-partners-pause" aria-pressed={paused} aria-label="إيقاف حركة شعارات الشركاء" onClick={() => setPaused(value => !value)}>
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            <span>{paused ? 'استئناف الحركة' : 'إيقاف الحركة'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
