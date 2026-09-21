import { useCmsTree, usePlatform } from './admin/platform';
import { rolePaths, trustedRole } from './auth/access';
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Menu,
  X,
  Users,
  UserRound,
  Play,
  CirclePlay,
  MousePointer2,
  Layers3,
  CalendarDays,
  Search,
  Mic,
  Box,
  Flag,
} from "lucide-react";
import LogoScene from "./LogoScene";
import HookExperience from "./home/HookExperience";
import Partners from "./home/Partners";
import usePublicPortfolio, { portfolioSlots } from './home/usePublicPortfolio';
import useStudioMotion from "./useStudioMotion";
import "./studio.css";

const PROFILE = "https://9eetksa.com/";
function Asterisk({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="11">
        {[0, 45, 90, 135].map((a) => (
          <path key={a} d="M50 3V97" transform={`rotate(${a} 50 50)`} />
        ))}
      </g>
    </svg>
  );
}
const services = [
  { title: "الإنتاج البصري", value: "خدمات الإنتاج", icon: CirclePlay, line: "من الفكرة إلى آخر لقطة", desc: "تصوير وإنتاج ومونتاج وموشن جرافيك تلتقي فيها الحرفة مع الفكرة لنصنع محتوى يعبّر عنك" },
  { title: "الفعاليات", value: "إدارة وتنظيم الفعاليات", icon: CalendarDays, line: "تفاصيل يجمعها أثر واحد", desc: "نخطط للتجربة وننظم تفاصيلها ونوثّق لحظاتها ليبقى أثر الحدث بعد نهايته" },
  { title: "الإعلام والاتصال", value: "الإعلام والاتصال", icon: Mic, line: "صوت يصل وصيت يبقى", desc: "استراتيجيات اتصال وحملات ومحتوى اجتماعي يقرّب علامتك من جمهورها ويمنحها حضورًا واضحًا" },
  { title: "المحتوى التعليمي", value: "إنتاج المحتوى التعليمي", icon: Layers3, line: "معرفة تستحق تجربة أجمل", desc: "نحوّل المعرفة إلى رحلات تعلّم ومحتوى مرئي وتفاعلي يجعل الفكرة أوضح والتجربة أقرب" },
  { title: "التجارب الغامرة", value: "التجارب الافتراضية", icon: MousePointer2, line: "زاوية أخرى للحكاية", desc: "تصوير بزاوية 360 درجة وجولات افتراضية وتجارب واقع افتراضي تتيح لجمهورك أن يعيش القصة" },
];
const process = [
  { title: "الاكتشاف", desc: "نفهمك نحلل السوق ونحدد الفرص", icon: Search },
  {
    title: "ابتكار المفهوم",
    desc: "نطور الفكرة ونرسم الاتجاه الإبداعي",
    icon: Mic,
  },
  { title: "التنفيذ", desc: "نحوّل الفكرة إلى واقع بأعلى جودة", icon: Box },
  { title: "المراجعة", desc: "نختبر ونحسّن لنضمن أفضل النتائج", icon: Users },
  { title: "التسليم", desc: "نطلق علامتك للعالم ونبقى معك للنمو", icon: Flag },
];
const navigation = [
  ["#home", "الرئيسية"],
  ["#work", "أعمالنا"],
  ["#partners", "شركاؤنا"],
  ["#services", "خدماتنا"],
  ["#about", "من نحن"],
  ["#process", "رحلتنا"],
  ["#contact", "تواصل معنا"],
];
function Logo() {
  return (
    <a className="s-logo" href="#home" aria-label="صيت — الرئيسية">
      <img
        src="/brand/seet-logo-light.svg"
        width="722"
        height="246"
        alt=""
      />
    </a>
  );
}
function ProjectCard({ project, hero = false }) {
  if (!project) return <div className="s-project s-project-empty" aria-hidden="true"><div className="s-project-image"/><p className="s-project-type">&nbsp;</p></div>;
  const Element = project.url ? 'a' : 'article';
  return (
    <Element
      className={hero ? "s-orbit-card" : "s-project"}
      href={project.url}
      target={project.url ? '_blank' : undefined}
      rel={project.url ? 'noopener noreferrer' : undefined}
      aria-label={project.name}
    >
      <div className="s-project-image">
        {project.image && <img
          src={project.image}
          alt={project.name}
          width="1172"
          height="646"
          loading={hero ? "eager" : "lazy"}
        />}
        <div className="s-project-caption">
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>
        {!hero && project.url && (
          <span className="s-project-open">
            <ArrowUpRight size={19} />
          </span>
        )}
      </div>
      {!hero && <p className="s-project-type">{project.name}</p>}
    </Element>
  );
}
function CarouselControls({ onPrevious, onNext, label, disabled = false }) {
  return (
    <div className="s-carousel-controls">
      <button
        className="s-round"
        aria-label={`${label} السابقة`}
        disabled={disabled}
        onClick={onPrevious}
      >
        <ArrowRight size={18} />
      </button>
      <button
        className="s-round"
        aria-label={`${label} التالية`}
        disabled={disabled}
        onClick={onNext}
      >
        <ArrowLeft size={18} />
      </button>
    </div>
  );
}
function QuoteForm() {
  return <section className="s-form seet-intake-note" dir="rtl"><span className="s-kicker">من الفكرة إلى التنفيذ</span><h3>كل طلب يبدأ مع مشرفك</h3><p>يتولى المشرف المسؤول تسجيل الطلب وتنسيق العمل مع الأقسام ومتابعة التسليم حتى اعتماده</p><a className="s-btn s-btn-lime" href="/login">دخول فريق صيت <ArrowLeft size={18}/></a></section>;
}
function Newsletter() { return <div className="s-newsletter"><strong>مساحة تجمع فريق صيت</strong><p>طلبات واضحة وتعاون أقرب وأثر يبقى</p></div>; }
export default function Studio() {
  const portfolio = usePublicPortfolio();
  const projects = portfolio.works;
  const cms = useCmsTree('home');
  const platform = usePlatform();
  const account = platform?.user;
  const authReady = platform?.authReady;
  const accountPath = account?.app_metadata?.must_change_password
    ? '/change-password'
    : account && sessionStorage.getItem('seet-recovery-user') === account.id
      ? '/reset-password'
      : rolePaths[trustedRole(account)] || '/login';
  const root = useRef(null),
    dialog = useRef(null);
  const [menu, setMenu] = useState(false),
    [service, setService] = useState(""),
    [modal, setModal] = useState(null);
  const [workIndex, setWorkIndex] = useState(0),
    [activeNav, setActiveNav] = useState("#home");
  useStudioMotion(root);
  useEffect(() => {
    if (!menu) return;
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMenu(false);
        root.current?.querySelector(".s-menu")?.focus();
      }
    }
    function closeOutside(event) {
      if (!event.target.closest(".s-header")) setMenu(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [menu]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActiveNav(`#${entry.target.id}`);
      },
      { rootMargin: "-12% 0px -65% 0px" },
    );
    root.current
      .querySelectorAll("main > section[id]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  function openModal(content) {
    setModal(content);
    dialog.current.showModal();
  }
  function closeModal() {
    dialog.current.close();
    setModal(null);
  }
  function chooseService(value) {
    setService(value);
    closeModal();
  }
  const cycle = (setter, offset) =>
    setter((value) => projects.length ? (value + offset + projects.length) % projects.length : 0);
  return cms(
    <div className="s-site seet-home" dir="rtl" ref={root}>
      <a href="#main" className="s-skip">
        تخطّ إلى المحتوى
      </a>
      <header className="s-header s-container">
        <Logo />
        <nav
          id="main-navigation"
          className={`s-nav${menu ? " is-open" : ""}`}
          aria-label="القائمة الرئيسية"
        >
          {navigation.map(([href, label]) => (
            <a
              key={href}
              href={href}
              aria-current={activeNav === href ? "location" : undefined}
              onClick={() => setMenu(false)}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="s-header-actions">
          {account ? <a className="s-btn s-btn-ghost s-account-link" href={accountPath} aria-label="حسابي" title="لوحة التحكم"><UserRound size={21} aria-hidden="true" /></a> : authReady && <a className="s-btn s-btn-ghost s-portal-link" href="/login">
            <UserRound size={16} /> دخول الفريق
          </a>}
          <a className="s-btn s-btn-outline s-explore-link" href="#work">
            استكشف أعمالنا <ArrowUpRight size={15} />
          </a>
          <a className="s-btn s-btn-lime" href="#contact">
            خلّنا نبدأ <ArrowUpRight size={16} />
          </a>
          <button
            className="s-menu s-round"
            aria-label={menu ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={menu}
            aria-controls="main-navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="main">
        <section className="s-hero" id="home" aria-labelledby="hero-title">
          <div className="s-container s-hero-layout">
            <div className="s-hero-copy">
              <span className="s-eyebrow seet-hero-eyebrow">بيت إبداعي سعودي</span>
              <h1 id="hero-title">من لقطة<br /><span className="seet-hero-end">إلى <img src="/brand/seet-logo-light.svg" width="722" height="246" alt="صيت" /></span></h1>
              <p>نصنع للصورة حكاية وللفكرة صيت<br />إنتاج ومحتوى وتجارب تعيش في الذاكرة</p>
              <div className="s-hero-ctas">
                <a href="#work" className="s-btn s-btn-lime">
                  استكشف أعمالنا <ArrowUpRight size={21} />
                </a>
                <button
                  className="s-story-button"
                  onClick={() =>
                    openModal({
                      type: "story",
                      title: "من فكرة إلى علامة تبقى",
                    })
                  }
                >
                  <span className="s-round">
                    <Play size={19} fill="currentColor" />
                  </span>
                  شاهد قصتنا
                </button>
              </div>
              <span className="s-hero-signature s-eyebrow">من أول فكرة إلى أثر يبقى</span>
            </div>
            <figure className="seet-hero-frame">
              <img src="/brand/official/project-01.webp" alt="من التغطية البصرية لموسم صيف عسير" width="1172" height="646" fetchpriority="high" />
              <figcaption><span>من أعمالنا</span><strong>موسم صيف عسير</strong><a href="#work" aria-label="اكتشف مشاريع صيت"><ArrowLeft size={22} /></a></figcaption>
              <span className="seet-frame-label" lang="en">SEET — SELECTED STORIES</span>
            </figure>
          </div>
        </section>
        <div className="s-ribbon" aria-hidden="true">
          <div className="s-ribbon-track">
            {[0, 1].map((copy) => <div className="s-ribbon-group" key={copy}>
            {[0, 1, 2, 3].map((n) => (
              <React.Fragment key={n}>
                <span>من لقطة إلى صيت</span>
                <Asterisk />
                <span lang="en">STORIES THAT STAY</span>
                <Asterisk />
              </React.Fragment>
            ))}
            </div>)}
          </div>
        </div>
        <section className="s-work s-bordered" id="work">
          <div className="s-container s-section-layout">
            <div className="s-section-intro">
              <span className="s-kicker">أعمال مختارة</span>
              <h2>
                قصص صنعناها
                <br />
                وصيت يبقى
              </h2>
              <p>
                نفخر بشراكات تصنع قصص نجاح وهذه بعض من أعمالنا التي نعتز بها
              </p>
              <CarouselControls
                label="الأعمال"
                disabled={projects.length <= 4}
                onPrevious={() => cycle(setWorkIndex, -1)}
                onNext={() => cycle(setWorkIndex, 1)}
              />
              <a
                className="s-all-work"
                href={PROFILE}
                target="_blank"
                rel="noopener noreferrer"
              >
                المزيد على موقع صيت <ArrowUpRight size={13} />
              </a>
            </div>
            <div className="s-project-grid" aria-busy={portfolio.loading}>
              {portfolioSlots(projects, workIndex).map((project, index) => (
                <ProjectCard key={project?.id || `empty-${index}`} project={project} />
              ))}
            </div>
            {portfolio.error && <p className="s-work-error" role="status">تعذر تحميل الأعمال <button onClick={portfolio.retry}>إعادة المحاولة</button></p>}
          </div>
        </section>
        <Partners />
        <section className="s-services s-bordered" id="services">
          <div className="s-container s-section-layout">
            <div className="s-section-intro">
              <span className="s-kicker">خدماتنا</span>
              <h2>
                فكرتك تستحق
                <br />
                أن تُروى
              </h2>
              <p>
                من الاستراتيجية إلى التنفيذ نقدم حلولاً إبداعية متكاملة تصنع
                الفرق وتدعم نمو علامتك
              </p>
              <button
                className="s-text-link"
                onClick={() =>
                  openModal({
                    type: "services",
                    title: "حلول متكاملة أثر أكبر",
                  })
                }
              >
                اكتشف جميع الخدمات <ArrowLeft size={17} />
              </button>
            </div>
            <div className="s-service-grid">
              {services.map((item) => (
                <button
                  className="s-service-card"
                  key={item.title}
                  onClick={() =>
                    openModal({ type: "service", title: item.title, item })
                  }
                >
                  <item.icon
                    className="s-service-icon"
                    size={32}
                    strokeWidth={1.6}
                  />
                  <h3>{item.title}</h3>
                  <p>{item.line}</p>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="s-about s-bordered" id="about">
          <div className="s-container s-about-layout">
            <div className="s-about-emblem">
              <span className="s-kicker">من نحن</span>
              <img src="/brand/seet-logo-dark.svg" width="722" height="246" alt="صيت" />
              <span className="s-eyebrow" lang="en">
                CREATIVE
                <br />
                STRATEGY
                <br />
                EXPERIENCE
                <br />
                IMPACT
              </span>
            </div>
            <div className="s-about-copy">
              <h2>
                فريق واحد
                <br />
                <span>وصيت يوصل بعيد</span>
              </h2>
              <p>
                نحن بيت إبداعي سعودي يجمع شغف الإنتاج وفكر التسويق
                نرافقك من الفكرة الأولى إلى ظهورها للعالم ونصنع معك قصصًا
                تحمل شخصيتك وتترك صيتًا يليق بك
              </p>
              <button
                className="s-btn s-btn-outline"
                onClick={() =>
                  openModal({
                    type: "about",
                    title: "من فكرة إلى علامة تبقى",
                  })
                }
              >
                المزيد عنا <ArrowLeft size={17} />
              </button>
            </div>
            <span className="s-about-signature s-eyebrow" lang="en">
              IDEAS
              <br />
              PEOPLE
              <br />
              BRANDS
              <br />A BRIGHTER TOMORROW
            </span>
          </div>
        </section>
        <section className="s-process s-bordered" id="process">
          <div className="s-container s-section-layout">
            <div className="s-section-intro">
              <span className="s-kicker">رحلتنا معك</span>
              <h2>من الفكرة إلى الواقع</h2>
              <p>خمس خطوات مدروسة لنحوّل رؤيتك إلى علامة تجارية ناجحة</p>
            </div>
            <ol className="s-process-list">
              {process.map((step, index) => (
                <li key={step.title}>
                  <span className="s-process-icon">
                    <step.icon size={23} strokeWidth={1.4} />
                  </span>
                  <span className="s-step-number">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section className="s-contact s-bordered" id="contact">
          <div className="s-container s-contact-layout">
            <div className="s-section-intro">
              <span className="s-kicker">طلبات صيت</span>
              <h2>
                لنحوّل فكرتك
                <br />
                إلى واقع
              </h2>
              <p>تواصل مع المشرف المسؤول ليتولى تفاصيل طلبك وتنسيق تنفيذه مع الفريق</p>
            </div>
            <QuoteForm service={service} setService={setService} />
            <div className="s-contact-art">
              <h3>
                كل فكرة عظيمة
                <br />
                تبدأ بمحادثة
              </h3>
              <a
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
              >
                لنبدأ مشروعك اليوم <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </section>
        {authReady && !account && <section className="s-portals s-bordered" id="portals">
          <div className="s-container s-portals-layout">
            <p className="s-portal-manifesto">
              أفكار
              <br />
              أشخاص
              <br />
              علامات
              <br />
              مستقبل أكثر إشراقاً
            </p>
            <button
              className="s-portal-card s-staff-portal"
              onClick={() =>
                window.location.assign('/login')
              }
            >
              <span className="s-portal-icon">
                <UserRound size={31} strokeWidth={1.4} />
              </span>
              <span>
                <b>دخول الفريق</b>
                <small>تابع مهامك ونسق العمل مع فريقك</small>
              </span>
              <span className="s-project-open">
                <ArrowUpRight size={19} />
              </span>
            </button>
            <div className="s-portals-copy">
              <h2>بوابتك إلى عالم صيت</h2>
              <p>مساحة واحدة للمشرفين والموظفين والإدارة</p>
            </div>
          </div>
        </section>}
      </main>
      <footer className="s-footer">
        <div className="s-container">
          <div className="s-footer-top">
            <Newsletter />
            <a
              className="s-behance"
              href={PROFILE}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="موقع صيت الرسمي"
            >
              موقعنا الرسمي <ArrowUpRight size={17} />
            </a>
            <nav aria-label="روابط التذييل">
              {navigation.map(([url, label]) => (
                <a key={url} href={url}>
                  {label}
                </a>
              ))}
            </nav>
            <a
              className="s-footer-word"
              href="#home"
              aria-label="صيت — إلى الأعلى"
            >
              <img src="/brand/seet-logo-light.svg" width="722" height="246" alt="صيت" />
              <small className="s-eyebrow" lang="en">
                STORIES THAT STAY
              </small>
            </a>
          </div>
          <div className="s-footer-bottom">
            <span>تصميم يصنع الفرق للعلامات التجارية</span>
            <span>
              © {new Date().getFullYear()} صيت جميع الحقوق محفوظة
            </span>
          </div>
        </div>
      </footer>
      <dialog
        ref={dialog}
        className={`s-dialog${modal?.type === "story" ? " s-intro-dialog" : modal?.type === "about" ? " s-story-dialog" : ""}`}
        aria-label={modal?.type === "story" ? "شاهد قصتنا" : undefined}
        aria-labelledby={modal?.type === "story" ? undefined : "dialog-title"}
        onClose={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) closeModal();
        }}
      >
        {modal?.type === "story" ? (
          <HookExperience onExit={closeModal} />
        ) : (
          <>
            <button
              className="s-dialog-close s-round"
              aria-label="إغلاق النافذة"
              onClick={closeModal}
            >
              <X size={20} />
            </button>
            <span className="s-kicker">صيت — إبداع يصنع الأثر</span>
            <h2 id="dialog-title">{modal?.title}</h2>
          </>
        )}
        {modal?.type === "about" && (
          <>
            <div className="s-story-scene">
              <LogoScene />
            </div>
            <p>
              نبدأ بالاستماع نبحث عن الفكرة التي تعبّر عنك ونحوّلها إلى هوية
              وتجربة تترك أثراً نجمع التفكير الاستراتيجي والتصميم والمحتوى
              والتنفيذ في فريق واحد لنمنح كل تفصيلة معنى
            </p>
            <a
              href="#contact"
              className="s-btn s-btn-lime"
              onClick={closeModal}
            >
              لنبدأ حكايتك <ArrowLeft size={18} />
            </a>
          </>
        )}
        {modal?.type === "service" && (
          <>
            <p>{modal.item.desc}</p>
            <a
              href="#contact"
              className="s-btn s-btn-lime"
              onClick={() => chooseService(modal.item.value)}
            >
              لنتحدث عن مشروعك <ArrowLeft size={18} />
            </a>
          </>
        )}
        {modal?.type === "services" && (
          <div className="s-dialog-services">
            {services.map((item) => (
              <article key={item.value}>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <a href="#contact" onClick={() => chooseService(item.value)}>
                  اطلب هذه الخدمة <ArrowUpRight size={15} />
                </a>
              </article>
            ))}
          </div>
        )}
        {modal?.type === "portal" && (
          <>
            <p>
              نعمل على بناء مساحة جديدة لإدارة المشاريع والتواصل البوابة غير
              متاحة بعد ويسعدنا خدمتك حالياً عبر واتساب
            </p>
            <a
              className="s-btn s-btn-lime"
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
            >
              تواصل مع الفريق <ArrowUpRight size={18} />
            </a>
          </>
        )}
      </dialog>
    </div>
  );
}
