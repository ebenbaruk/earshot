"use client";

import { useEffect, useRef, useState } from "react";
import { ObjectGlyph } from "@/components/ObjectGlyph";
import { Hud, PolicyLine } from "@/components/Hud";
import { RightRail } from "@/components/RightRail";
import { TopBar } from "@/components/TopBar";
import { SensoryField } from "@/components/SensoryField";
import { SceneNoSSR } from "@/components/Scene/SceneNoSSR";
import { useEarshot } from "@/lib/earshot/useEarshot";

const OBJECT_DETAILS: Record<string, { name: string; lesson: string }> = {
  sponge: { name: "Softness.", lesson: "Know when to squeeze." },
  tape_holder: { name: "Precision.", lesson: "Find a better grip." },
  marker: { name: "Balance.", lesson: "Get the order right." },
  egg: { name: "Care.", lesson: "Some things need a gentler touch." },
};

const LESSONS = [
  { title: "Let it try.", text: "Start the experiment. The robot plans its own moves to pack four everyday objects into a bag. Watch where its intuition falls short." },
  { title: "Trust your instinct.", text: "Enable your microphone or type a correction. Say “Stop, a bit to the left” or “Squeeze it first.” Your guidance changes what happens next." },
  { title: "Make the lesson last.", text: "Select Learn from corrections. Earshot turns your interventions into a new policy. Run the same scene again and see what it learned." },
];

export function EarshotApp() {
  const { vm, actions } = useEarshot();
  const [orbit, setOrbit] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    root.current?.querySelectorAll("[data-reveal]").forEach(element => observer.observe(element));
    // The app mounts client-side after the first paint, so the browser's own
    // hash navigation ran on an empty page: honour deep links (/#experiment).
    const hash = window.location.hash.slice(1);
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (hash) {
      // The console mounts a beat after the shell; retry a few times so a deep
      // link (/#experiment) lands on it even on a cold, slow load.
      let attempts = 0;
      const jump = () => {
        const target = document.getElementById(hash);
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
          if (hash === "experiment") target.focus({ preventScroll: true });
        }
        if (attempts++ < 6) timer = setTimeout(jump, 250);
      };
      timer = setTimeout(jump, 50);
    }
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="experience" ref={root}>
      <a href="#experiment" className="skip-link">Skip to the experiment</a>
      <nav className="floating-nav" aria-label="Main navigation">
        <a href="#experiment">THE DEMO <span>↙</span></a>
        <a href="#home" className="wordmark" aria-label="Earshot home">earshot<span aria-hidden="true">✳</span></a>
        <a href="#how-it-works">THE IDEA <span>↗</span></a>
      </nav>

      <main>
        <section className="intro-scene" id="home" aria-labelledby="intro-title">
          <SensoryField />
          <div className="hero-shade" />
          <div className="hero-caption"><span className="signal-dot" /> HUMAN-IN-THE-LOOP, REIMAGINED.</div>
          <div className="hero-title-wrap">
            <h1 id="intro-title"><span>A little human.</span><span>A lot more possible.</span></h1>
            <p>Robots learn the moves.<br />You teach them the feeling.</p>
            <a className="hero-cta" href="#experiment"><span>Enter the experiment</span><span className="round-arrow">↗</span></a>
          </div>
          <div className="hero-bottom"><a href="#the-idea">SCROLL TO DISCOVER <span>↓</span></a><span>VOICE → ACTION → UNDERSTANDING</span><span>EARSHOT / EXPERIMENT 001</span></div>
        </section>

        <section className="idea-section" id="the-idea">
          <div className="section-kicker" data-reveal><span>01 — A SIMPLE IDEA</span><span>INTELLIGENCE IS A CONVERSATION.</span></div>
          <div className="idea-layout" data-reveal>
            <h2>What if your instinct<br />became its<br /><span>next move?</span></h2>
            <div className="idea-aside"><span className="asterisk" aria-hidden>✳</span><p>Some things are hard to put into code.<br />A softer grip. A little to the left.<br />Knowing when to stop.</p><p>Earshot gives autonomous robots something they’re missing.<br /><strong>You.</strong></p><a className="text-link" href="#experiment">See what we mean <span>↘</span></a></div>
          </div>
        </section>

        <section className="experiment-section dark-surface" id="live-demo" aria-labelledby="experiment-title">
          <div className="experiment-intro" data-reveal>
            <div><span className="section-kicker">02 — THE LIVE EXPERIMENT</span><h2 id="experiment-title">Meet your<br /><span>work in progress.</span></h2></div>
            <div className="experiment-description"><p>One robot. Four objects.<br />A few things only you can teach it.</p><span><i className={vm.status === "running" ? "signal-dot active" : "signal-dot"} /> {vm.status === "running" ? "EXPERIMENT RUNNING" : "READY WHEN YOU ARE"}</span></div>
          </div>
          <div className="experiment-console" id="experiment" tabIndex={-1}>
            <TopBar vm={vm} actions={actions} />
            <div className="studio-grid">
              <section className="simulation-panel" aria-label="Robot simulation">
                <div className="scene-viewport">
                  <SceneNoSSR className="h-full w-full" orbit={orbit} />
                  <Hud vm={vm} actions={actions} />
                  <span className="scene-watermark" aria-hidden>earshot</span>
                </div>
                <div className="scene-toolbar"><span>ES—01 <span className="toolbar-divider">/</span> {orbit ? "Drag to orbit · scroll to zoom" : "Live workspace"}</span><button type="button" aria-pressed={orbit} onClick={() => setOrbit(!orbit)}>{orbit ? "Reset camera ↺" : "Explore in 3D ↗"}</button></div>
                <PolicyLine vm={vm} />
              </section>
              <RightRail vm={vm} actions={actions} />
            </div>
          </div>
          <div className="object-manifest">
            {vm.world.objects.map((object, i) => (
              <div className="object-card" key={object.id}>
                <div className="object-card-top"><span>0{i + 1}</span><span>{object.state === "in_bag" ? "✓ PACKED" : object.state.replaceAll("_", " ").toUpperCase()}</span></div>
                <ObjectGlyph id={object.id} />
                <h3>{OBJECT_DETAILS[object.id]?.name}</h3>
                <p>{OBJECT_DETAILS[object.id]?.lesson}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="method-section" id="how-it-works">
          <div className="method-heading" data-reveal><span className="section-kicker">03 — FROM INTERRUPTION TO INTUITION</span><h2>Better together.<br /><span>By design.</span></h2><p>No training manual. Just a conversation.</p></div>
          <div className="method-steps" data-reveal>{LESSONS.map((lesson, i) => <details key={lesson.title} open={i === 0}><summary><span>0{i + 1}</span><h3>{lesson.title}</h3><span className="details-plus">+</span></summary><p>{lesson.text}</p></details>)}</div>
        </section>
        <footer className="experience-footer"><div><span>THE FUTURE HAS A HUMAN SIDE.</span><a href="#experiment">Give it a voice <span>↗</span></a></div><a href="#home" className="footer-wordmark" aria-label="Back to top">earshot<span aria-hidden="true">✳</span></a><div className="footer-meta"><span>A LIVE EXPERIMENT IN LEARNING.</span><span>BUILT TO LISTEN.</span><a href="#home">BACK TO TOP ↑</a></div></footer>
      </main>
    </div>
  );
}
