import React, {useEffect, useRef, useState} from 'react';
import {ArrowDown, ArrowUpLeft, ArrowUpRight, Menu, X} from 'lucide-react';
import gsap from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
import {usePlatform} from '../admin/platform';
import {rolePaths, trustedRole} from '../auth/access';
import CinemaPartners from './CinemaPartners';
import './cinema-home.css';

gsap.registerPlugin(ScrollTrigger);
const frames = ['/brand/official/project-01.webp', '/brand/official/project-02.webp', '/brand/official/project-04.webp'];
const nav = [['#story', 'الفكرة'], ['#partners', 'من وثق بنا'], ['#contact', 'خلّنا نتكلم']];

function Brand({dark = false}) {
  return <img src={`/brand/seet-logo-${dark ? 'black' : 'white'}-red.png`} width="160" height="72" alt="صيت" className="c-logo"/>;
}

function useCinemaMotion(root, setChapter) {
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference) and (min-height: 581px)', () => {
      const scope = gsap.context(() => {
        gsap.from('.c-hero-title > span', {y:48, opacity:0, stagger:.13, duration:.9, ease:'power3.out', clearProps:'transform,opacity'});
        const story = root.current.querySelector('.c-story');
        const edit = gsap.timeline({scrollTrigger:{trigger:story, start:'top top', end:'bottom bottom', scrub:.65, invalidateOnRefresh:true,
          onUpdate:self => setChapter(self.progress >= .52 ? 1 : 0)}});
        edit.fromTo('.c-capture-image', {scale:1.12}, {scale:1, duration:.38}, 0)
          .to('.c-viewfinder', {scale:1.08, opacity:0, duration:.18}, .32)
          .to('.c-capture-copy', {y:-40, opacity:0, duration:.18}, .34)
          .to('.c-capture-image', {scale:.82, opacity:0, duration:.22}, .4)
          .fromTo('.c-edit', {clipPath:'inset(100% 0 0 0)'}, {clipPath:'inset(0% 0 0 0)', duration:.23}, .44)
          .fromTo('.c-edit-frame', {y:90, rotate:0, opacity:0}, {y:0, rotate:i => [-9,4,-3][i], opacity:1, stagger:.045, duration:.24}, .5)
          .fromTo('.c-edit-copy', {y:28, opacity:0}, {y:0, opacity:1, duration:.18}, .66)
          .fromTo('.c-timeline-progress', {scaleX:0}, {scaleX:1, duration:.18}, .8);
      }, root);
      return () => {scope.revert(); setChapter(0);};
    });
    return () => media.revert();
  }, [root, setChapter]);
}

export default function CinemaHome() {
  const root = useRef(null), menuButton = useRef(null);
  const [menu, setMenu] = useState(false), [chapter, setChapter] = useState(0);
  const platform = usePlatform(), user = platform?.user;
  const accountPath = user?.app_metadata?.must_change_password ? '/change-password'
    : user && sessionStorage.getItem('seet-recovery-user') === user.id ? '/reset-password'
    : rolePaths[trustedRole(user)] || '/login';
  useCinemaMotion(root, setChapter);
  useEffect(() => {
    if (!menu) return;
    const close = event => {if(event.key === 'Escape'){setMenu(false); menuButton.current?.focus();}};
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);
  function jumpChapter(index) {
    const story = root.current.querySelector('#story');
    if (matchMedia('(prefers-reduced-motion: reduce), (max-height: 580px)').matches) {
      root.current.querySelector(index ? '#edit-chapter' : '#capture-chapter').scrollIntoView({block:'start'});
      return;
    }
    const start = story.getBoundingClientRect().top + window.scrollY;
    const distance = story.offsetHeight - root.current.querySelector('.c-story-stage').offsetHeight;
    window.scrollTo({top:start + distance * (index ? .92 : 0), behavior:'smooth'});
  }
  return <div className="c-home" dir="rtl" ref={root}>
    <a className="c-skip" href="#main">تخط إلى المحتوى</a>
    <header className="c-header">
      <a href="#home" aria-label="صيت — الرئيسية"><Brand/></a>
      <nav className={`c-nav ${menu ? 'is-open' : ''}`} id="cinema-nav" aria-label="التنقل الرئيسي">
        {nav.map(([href,label]) => <a href={href} key={href} onClick={() => setMenu(false)}>{label}</a>)}
      </nav>
      <div className="c-header-actions">
        <a className="c-account" href={accountPath}>{platform?.authReady && user ? 'مساحة عملي' : 'دخول الفريق'}<ArrowUpLeft size={17} aria-hidden="true"/></a>
        <button className="c-menu" ref={menuButton} aria-label={menu ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={menu} aria-controls="cinema-nav" onClick={() => setMenu(value => !value)}>{menu ? <X/> : <Menu/>}</button>
      </div>
    </header>

    <main id="main" tabIndex={-1}>
      <section className="c-hero" id="home" aria-labelledby="cinema-title">
        <div className="c-hero-top"><span>نحكيها بطريقتنا</span><span lang="en">SEET / CREATIVE PRODUCTION</span></div>
        <div className="c-hero-image"><img src={frames[0]} alt="تغطية صيت لموسم صيف عسير" width="1172" height="646" fetchpriority="high"/><div className="c-image-shade"/></div>
        <div className="c-hero-content">
          <h1 className="c-hero-title" id="cinema-title"><span>نصنع اللقطة</span><span>ونترك <em>الصيت</em></span></h1>
          <div className="c-hero-bottom">
            <p>تصوير يلفت<br/>مونتاج يُحسّ وإخراج يبقى</p>
            <a className="c-story-link" href="#story"><span className="c-story-arrow"><ArrowDown size={29} aria-hidden="true"/></span><span>ادخل الحكاية<small>مشهدان وكل الفكرة</small></span></a>
          </div>
        </div>
        <div className="c-hero-caption"><span>من عدسة صيت</span><span>موسم صيف عسير</span><span className="c-record" lang="en">IN FRAME</span></div>
      </section>

      <section className="c-story" id="story" aria-label="فكرة صيت في مشهدين">
        <div className="c-story-stage">
          <div className="c-story-top"><span>فكرتك من أول كادر إلى آخر أثر</span><a href="#contact">تخط الحكاية <ArrowDown size={15} aria-hidden="true"/></a></div>
          <article className="c-capture" id="capture-chapter" aria-labelledby="capture-title">
            <img className="c-capture-image" src={frames[1]} alt="لحظة من سباق العلا وثقتها صيت" width="1172" height="646" loading="lazy"/>
            <div className="c-capture-shade"/>
            <div className="c-viewfinder" aria-hidden="true"><i/><i/><i/><i/><span>+</span></div>
            <div className="c-capture-copy"><span className="c-chapter-label">المشهد الأول / التصوير</span><h2 id="capture-title">نشوفها<br/><em>بزاوية ثانية</em></h2><p>ضوء ولحظة وعين تعرف أين تقف</p></div>
          </article>
          <article className="c-edit" id="edit-chapter" aria-labelledby="edit-title">
            <div className="c-edit-frames" aria-hidden="true">{frames.map((frame,index) => <figure className="c-edit-frame" key={frame}><img src={frame} alt="" width="1172" height="646" loading="lazy"/><figcaption><span lang="en">SEET / TAKE {String(index+1).padStart(2,'0')}</span><span>صورة لها حكاية</span></figcaption></figure>)}</div>
            <div className="c-edit-copy"><span className="c-chapter-label">المشهد الثاني / المونتاج والإخراج</span><h2 id="edit-title">نعطيها إحساس<br/>ونخلّي لها <em>صيت</em></h2><p>نختار الإيقاع ونربط التفاصيل لتصل الحكاية كما تخيلناها</p></div>
            <div className="c-timeline" aria-hidden="true"><span lang="en">THE FINAL CUT</span><div>{Array.from({length:20},(_,i)=><i key={i} style={{'--bar':`${24+(i*17)%67}%`}}/>)}<b className="c-timeline-progress"/></div></div>
          </article>
          <div className="c-story-controls" aria-label="مشاهد الحكاية">
            <button onClick={() => jumpChapter(0)} aria-pressed={chapter===0}><span>01</span> تصوير</button>
            <span className="c-story-control-line" aria-hidden="true"/>
            <button onClick={() => jumpChapter(1)} aria-pressed={chapter===1}><span>02</span> مونتاج وإخراج</button>
            <span className="c-scroll-caption">مرّر لتكمل الحكاية <ArrowDown size={14} aria-hidden="true"/></span>
          </div>
        </div>
      </section>

      <CinemaPartners/>

      <footer className="c-footer" id="contact">
        <div className="c-footer-main"><div><span className="c-eyebrow">عندك فكرة؟</span><h2>خلّها تاخذ<br/><em>صيت</em></h2></div><a className="c-contact-link" href="https://wa.me/966559839698" target="_blank" rel="noopener noreferrer" aria-label="تواصل مع صيت على واتساب"><ArrowUpLeft aria-hidden="true"/><span>خلّنا نتكلم</span></a></div>
        <div className="c-footer-bottom"><a href="#home" aria-label="العودة إلى بداية الصفحة"><Brand dark/></a><span>تصوير · مونتاج · إخراج</span><a href={accountPath}>مساحة فريق صيت <ArrowUpRight size={16} aria-hidden="true"/></a></div>
      </footer>
    </main>
  </div>;
}
