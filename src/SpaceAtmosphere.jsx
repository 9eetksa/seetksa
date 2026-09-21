import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import "./space-atmosphere.css";

// Fixed coordinates keep the scene stable across renders and navigation.
const stars = [
  [4, 12],
  [16, 7],
  [29, 21],
  [44, 9],
  [63, 16],
  [81, 8],
  [94, 23],
  [8, 36],
  [22, 48],
  [38, 32],
  [57, 43],
  [74, 31],
  [89, 47],
  [3, 62],
  [17, 76],
  [32, 63],
  [48, 81],
  [66, 68],
  [84, 79],
  [96, 65],
  [9, 91],
  [36, 94],
  [72, 93],
  [93, 92],
];
const motion = { twinkle: 2.8, meteorTravel: 2.4, meteorGap: 7 };
const depths = [0, 1, 2];

export default function SpaceAtmosphere() {
  const host = useRef(null);

  useEffect(() => {
    const media = gsap.matchMedia();
    media.add(
      {
        enabled: "(prefers-reduced-motion: no-preference)",
        compact: "(max-width: 700px)",
        pointer: "(hover: hover) and (pointer: fine)",
      },
      ({ conditions }) => {
        if (!conditions.enabled) return;
        const points = Array.from(host.current.querySelectorAll(".space-star"));
        const trails = Array.from(
          host.current.querySelectorAll(".space-meteor"),
        );
        const visiblePoints = points.filter((point) =>
          !conditions.compact || Number(point.dataset.index) < 12,
        );
        const twinkle = gsap.to(visiblePoints, {
          opacity: (index) => 0.45 + (index % 4) * 0.13,
          scale: (index) => 1.15 + (index % 3) * 0.2,
          duration: (index) => motion.twinkle + (index % 4),
          stagger: { each: 0.31, repeat: -1, yoyo: true },
          ease: "sine.inOut",
        });
        const layers = Array.from(host.current.querySelectorAll(".space-star-field"));
        const drift = layers.map((layer, depth) => gsap.fromTo(layer,
          { x: -12 * (depth + 1), y: 10 * (depth + 1), rotation: -0.6 },
          {
            x: 16 * (depth + 1), y: -14 * (depth + 1), rotation: 0.6,
            duration: 26 - depth * 6, repeat: -1, yoyo: true, ease: "sine.inOut",
          },
        ));
        const parallax = conditions.pointer && !conditions.compact
          ? Array.from(host.current.querySelectorAll(".space-star-layer")).map((layer, depth) => ({
              x: gsap.quickTo(layer, "x", { duration: 1.8, ease: "power2.out" }),
              y: gsap.quickTo(layer, "y", { duration: 1.8, ease: "power2.out" }),
              depth: (depth + 1) * 12,
            }))
          : [];
        const onPointerMove = (event) => {
          if (host.current.dataset.paused === "true") return;
          parallax.forEach(({ x, y, depth }) => {
            x((event.clientX / window.innerWidth - 0.5) * depth);
            y((event.clientY / window.innerHeight - 0.5) * depth);
          });
        };
        const resetPointer = () => parallax.forEach(({ x, y }) => { x(0); y(0); });
        if (parallax.length) {
          window.addEventListener("pointermove", onPointerMove, { passive: true });
          document.documentElement.addEventListener("pointerleave", resetPointer);
        }
        const meteors = gsap.timeline({
          repeat: -1,
          delay: 1.5,
          repeatDelay: conditions.compact ? 18 : motion.meteorGap,
        });
        trails.slice(0, conditions.compact ? 1 : 2).forEach((trail, index) => {
          const start = index * (motion.meteorTravel + motion.meteorGap);
          meteors.fromTo(
            trail,
            { x: -140, y: -62, opacity: 0 },
            { x: 360, y: 160, duration: motion.meteorTravel, ease: "none" },
            start,
          );
          meteors.to(
            trail,
            { opacity: 0.7, duration: 0.5, ease: "sine.inOut" },
            start,
          );
          meteors.to(
            trail,
            { opacity: 0, duration: 0.9, ease: "sine.inOut" },
            start + 1.5,
          );
        });

        // No background work while the tab is hidden or a dialog needs attention.
        const syncPlayback = () => {
          const paused =
            document.hidden || !!document.querySelector("dialog[open]");
          twinkle.paused(paused);
          meteors.paused(paused);
          drift.forEach((animation) => animation.paused(paused));
          parallax.forEach(({ x, y }) => { x.tween.paused(paused); y.tween.paused(paused); });
          host.current.dataset.paused = String(paused);
        };
        const observer = new MutationObserver(syncPlayback);
        document.querySelectorAll("dialog").forEach((dialog) => {
          observer.observe(dialog, {
            attributes: true,
            attributeFilter: ["open"],
          });
        });
        document.addEventListener("visibilitychange", syncPlayback);
        syncPlayback();
        return () => {
          observer.disconnect();
          document.removeEventListener("visibilitychange", syncPlayback);
          window.removeEventListener("pointermove", onPointerMove);
          document.documentElement.removeEventListener("pointerleave", resetPointer);
          twinkle.kill();
          meteors.kill();
          drift.forEach((animation) => animation.kill());
          parallax.forEach(({ x, y }) => { x.tween.kill(); y.tween.kill(); });
          if (host.current) delete host.current.dataset.paused;
        };
      },
      host,
    );
    return () => media.revert();
  }, []);

  return (
    <div className="space-atmosphere" ref={host} aria-hidden="true">
      {depths.map((depth) => (
        <div className={`space-star-layer space-star-layer-${depth}`} key={depth}>
          <div className="space-star-field">
            {stars.map(([left, top], index) => (
              <span
                key={index}
                data-index={index}
                className="space-star"
                style={{ left: `${(left + depth * 19) % 100}%`, top: `${(top + depth * 27) % 100}%` }}
              />
            ))}
          </div>
        </div>
      ))}
      <span className="space-meteor space-meteor-one" />
      <span className="space-meteor space-meteor-two" />
    </div>
  );
}
