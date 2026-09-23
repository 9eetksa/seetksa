import React, {useEffect, useRef, useState} from 'react';
import {ArrowDown, ArrowUpLeft, ArrowUpRight, Menu, X, Pause, Play} from 'lucide-react';
import {usePlatform} from '../admin/platform';
import {rolePaths, trustedRole} from '../auth/access';
import CinemaPartners from './CinemaPartners';
import useHeroFilm from './useHeroFilm';
import './cinema-home.css';

const heroPoster = '/brand/official/project-01.webp';
const nav = [['#home', 'الرئيسية'], ['#partners', 'من وثق بنا'], ['#contact', 'خلّنا نتكلم']];

function Brand({dark = false}) {
  return <img src={`/brand/seet-logo-${dark ? 'black' : 'white'}-red.png`} width="160" height="72" alt="صيت" className="c-logo"/>;
}

export default function CinemaHome() {
  const root = useRef(null), menuButton = useRef(null);
  const [menu, setMenu] = useState(false);
  const film = useHeroFilm();
  const platform = usePlatform(), user = platform?.user;
  const accountPath = user?.app_metadata?.must_change_password ? '/change-password'
    : user && sessionStorage.getItem('seet-recovery-user') === user.id ? '/reset-password'
    : rolePaths[trustedRole(user)] || '/login';
  useEffect(() => {
    if (!menu) return;
    const close = event => {if(event.key === 'Escape'){setMenu(false); menuButton.current?.focus();}};
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);
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
        <div className="c-hero-image">
          <img src={heroPoster} alt="تغطية صيت لموسم صيف عسير" width="1172" height="646" fetchpriority="high"/>
          <video ref={film.ref} id="seet-hero-film" className="c-hero-film" src="/brand/official/seet-asir-hero.mp4" poster={heroPoster} muted loop playsInline preload="metadata" aria-hidden="true" hidden={film.failed}/>
          <div className="c-image-shade"/>
        </div>
        <div className="c-hero-content">
          <h1 className="c-sr-only" id="cinema-title">صيت — تصوير ومونتاج وإخراج</h1>
          <div className="c-hero-bottom">
            <a className="c-story-link" href="#partners"><span className="c-story-arrow"><ArrowDown size={29} aria-hidden="true"/></span><span>من وثق بنا<small>شركاء النجاح</small></span></a>
          </div>
        </div>
        <div className="c-hero-caption"><span>من عدسة صيت</span><span>موسم صيف عسير</span><span className="c-record" lang="en">IN FRAME</span>
          {!film.failed && <button type="button" className="c-film-toggle" aria-controls="seet-hero-film" onClick={film.toggle} aria-label={film.playing ? 'إيقاف فيديو الخلفية' : 'تشغيل فيديو الخلفية'}>{film.playing ? <Pause size={16}/> : <Play size={16}/>}</button>}
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
