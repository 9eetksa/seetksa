import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export default function useStudioMotion(root) {
  useEffect(() => {
    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add("(prefers-reduced-motion: no-preference)", () => {
        if (root.current.querySelector('.s-hero-copy')) gsap.from(".s-hero-copy > *", {
          y: 20,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power2.out",
          clearProps: "all",
        });
        if (root.current.querySelector('.s-orbit-cards')) gsap.from(".s-orbit-cards", {
          y: 25,
          opacity: 0,
          duration: 1,
          delay: 0.15,
          ease: "power2.out",
          clearProps: "all",
        });
        gsap.utils
          .toArray(
            ".s-service-grid,.s-project-grid,.s-about-copy,.s-process-list,.s-form,.s-portals-layout",
          )
          .forEach((element) => {
            gsap.from(element, {
              y: 22,
              duration: 0.7,
              ease: "power2.out",
              clearProps: "transform",
              scrollTrigger: { trigger: element, start: "top 94%", once: true },
            });
          });
      });
    }, root);
    return () => {
      media.revert();
      context.revert();
    };
  }, [root]);
}
