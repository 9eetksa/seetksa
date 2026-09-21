import React, { useEffect, useRef } from "react";
import gsap from "gsap";

// One shared stage for all routes with composited motion and no WebGL dependency
export default function BrandAtmosphere() {
  const host = useRef(null);
  useEffect(() => {
    const root = host.current;
    const scope = root.parentElement;
    let scrollSurface = document.scrollingElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const page = scrollSurface.isConnected ? scrollSurface : document.scrollingElement;
      const distance = Math.max(0, page.scrollHeight - page.clientHeight);
      const progress = distance > 1 ? Math.min(1, Math.max(0, page.scrollTop / distance)) : 0;
      root.style.setProperty("--brand-scroll-dark", String(progress ** 1.15));
      root.style.setProperty("--brand-scroll-rise", String(Math.sin(progress * Math.PI)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(() => discover());
    const discover = () => {
      // Only the page canvas controls the atmosphere not dialogs or notification lists
      const canvas = scope.querySelector('.a-canvas');
      const next = canvas && /auto|scroll/.test(getComputedStyle(canvas).overflowY)
        && canvas.scrollHeight > canvas.clientHeight ? canvas : document.scrollingElement;
      if (next !== scrollSurface) {
        resize.unobserve(scrollSurface);
        scrollSurface = next;
        resize.observe(scrollSurface);
      }
      schedule();
    };
    const onScroll = (event) => {
      if (event.target === document || event.target === scrollSurface) schedule();
    };
    const changes = new MutationObserver(discover);
    changes.observe(scope, { childList: true, subtree: true });
    resize.observe(scope);
    resize.observe(scrollSurface);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", discover, { passive: true });
    discover();
    update();
    return () => {
      resize.disconnect();
      changes.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", discover);
    };
  }, []);
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        pointer: "(hover: hover) and (pointer: fine)",
        compact: "(max-width: 700px)",
      },
      ({ conditions }) => {
        if (!conditions.motion) return;
        const root = host.current,
          scope = root.parentElement,
          animations = [];
        const scene = root.querySelector(".brand-stage-art"),
          beam = root.querySelector(".brand-stage-beam"),
          facets = [...root.querySelectorAll(".brand-stage-facet")];
        root.querySelectorAll(".brand-stage-smoke").forEach((el, i) => {
          animations.push(gsap.fromTo(el,
            { xPercent: i ? 5 : -5, yPercent: 4, scale: 1, rotation: i ? 9 : -8 },
            { xPercent: i ? -5 : 5, yPercent: -5, scale: 1.12, rotation: i ? -3 : 2,
              duration: 34 + i * 9, repeat: -1, yoyo: true, ease: "sine.inOut" },
          ));
        });
        animations.push(
          gsap.fromTo(
            scene,
            { scale: 1.04 },
            {
              scale: 1.09,
              duration: 32,
              repeat: -1,
              yoyo: true,
              ease: "sine.inOut",
            },
          ),
        );
        animations.push(
          gsap.fromTo(
            beam,
            { xPercent: -12, rotation: -12, opacity: 0.18 },
            {
              xPercent: 12,
              rotation: 7,
              opacity: 0.45,
              duration: 18,
              repeat: -1,
              yoyo: true,
              ease: "sine.inOut",
            },
          ),
        );
        facets.forEach((el, i) =>
          animations.push(
            gsap.to(el, {
              y: i % 2 ? 22 : -26,
              rotation: i % 2 ? -5 : 6,
              duration: 14 + i * 6,
              repeat: -1,
              yoyo: true,
              ease: "sine.inOut",
            }),
          ),
        );
        root.querySelectorAll(".brand-diamond-glint").forEach((el, i) => {
          const shimmer = gsap.timeline({ repeat: -1, repeatDelay: 3.5, delay: i * 1.7 });
          shimmer.fromTo(el,
            { opacity: 0, scale: 0.65, transformOrigin: "50% 50%" },
            { opacity: 0.9, scale: 1.15, duration: 1.6, ease: "sine.inOut" },
          ).to(el, { opacity: 0, scale: 0.8, duration: 2.2, ease: "sine.inOut" });
          animations.push(shimmer);
        });
        animations.push(gsap.fromTo(root.querySelector(".brand-diamond-reflection"),
          { opacity: 0.12, x: -18, scaleX: 0.8, transformOrigin: "50% 50%" },
          { opacity: 0.55, x: 18, scaleX: 1.12, duration: 4.5, repeat: -1, yoyo: true, ease: "sine.inOut" },
        ));
        const glow = root.querySelector(".brand-stage-pointer");
        const x =
          conditions.pointer && !conditions.compact
            ? gsap.quickTo(glow, "x", { duration: 1.4, ease: "power2.out" })
            : null;
        const y = x
          ? gsap.quickTo(glow, "y", { duration: 1.4, ease: "power2.out" })
          : null;
        const move = (e) => {
          if (!document.hidden) {
            x?.(e.clientX - innerWidth * 0.5);
            y?.(e.clientY - innerHeight * 0.5);
          }
        };
        if (x) window.addEventListener("pointermove", move, { passive: true });
        const seen = new WeakSet(),
          entrances = new Set();
        let frame;
        const reveal = () => {
          const nodes = [
            ...scope.querySelectorAll(
              ".a-heading,.a-command-metrics>button,.a-command-panel,.a-command-hero,.a-workspace-cards>article,.a-profile,.a-section,.p-panel,.p-showcase",
            ),
          ].filter((el) => !seen.has(el));
          nodes.forEach((el) => seen.add(el));
          if (nodes.length) {
            const tween = gsap.fromTo(
              nodes,
              { opacity: 0, y: 16 },
              {
                opacity: 1,
                y: 0,
                duration: 0.6,
                stagger: 0.045,
                ease: "power2.out",
                clearProps: "opacity,transform",
                onComplete: () => entrances.delete(tween),
              },
            );
            entrances.add(tween);
          }
        };
        const observer = new MutationObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(reveal);
        });
        observer.observe(scope, { childList: true, subtree: true });
        reveal();
        const playback = () => {
          const paused = document.hidden;
          animations.forEach((t) => t.paused(paused));
          entrances.forEach((t) => t.paused(paused));
          x?.tween.paused(paused);
          y?.tween.paused(paused);
        };
        document.addEventListener("visibilitychange", playback);
        playback();
        return () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
          document.removeEventListener("visibilitychange", playback);
          window.removeEventListener("pointermove", move);
          animations.forEach((t) => t.kill());
          entrances.forEach((t) => {
            const targets = t.targets();
            t.kill();
            gsap.set(targets, { clearProps: "opacity,transform" });
          });
          x?.tween.kill();
          y?.tween.kill();
        };
      },
      host,
    );
    return () => media.revert();
  }, []);
  return (
    <div className="brand-stage" ref={host} aria-hidden="true">
      <div className="brand-stage-art">
        <svg className="brand-diamond-light" viewBox="0 0 1672 941" fill="none">
          <g className="brand-diamond-reflection" stroke="#f49898" strokeWidth="2">
            <path d="M265 852 Q370 839 553 848 M204 875 Q347 861 495 866 M296 897 Q348 886 419 888" />
          </g>
          {[[365, 815, -18], [431, 444, 28], [1234, 482, 20], [1603, 807, -14]].map(([x, y, angle]) => (
            <g key={x} transform={`translate(${x} ${y}) rotate(${angle})`}>
              <g className="brand-diamond-glint">
                <path d="M0 -65 L2 -5 L46 0 L2 5 L0 65 L-2 5 L-46 0 L-2 -5Z" fill="#eee9e9" opacity="0.7" />
                <path d="M0 -24 L3 -3 L24 0 L3 3 L0 24 L-3 3 L-24 0 L-3 -3Z" fill="#fffef2" />
                <circle r="4" fill="white" />
                <circle r="15" fill="#f39696" opacity="0.16" />
              </g>
            </g>
          ))}
        </svg>
      </div>
      <div className="brand-stage-beam" />
      <div className="brand-stage-pointer" />
      <div className="brand-stage-facet brand-stage-facet-left" />
      <div className="brand-stage-facet brand-stage-facet-right" />
      <div className="brand-stage-facet brand-stage-facet-low" />
      <div className="brand-stage-smoke brand-stage-smoke-left" />
      <div className="brand-stage-smoke brand-stage-smoke-right" />
      <div className="brand-stage-shade" />
      <div className="brand-stage-scroll-rise" />
      <div className="brand-stage-scroll-dark" />
    </div>
  );
}
