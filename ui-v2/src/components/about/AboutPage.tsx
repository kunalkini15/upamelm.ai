import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, BookOpen, Box, Check, FileSearch, Layers3, Map, Orbit, Quote, ScanSearch, Sparkles } from 'lucide-react';

const principles = [
  ['01', 'Place', 'Show scientific information where it belongs.'],
  ['02', 'Meaning', 'Explain why an observation matters in human language.'],
  ['03', 'Evidence', 'Keep every conclusion connected to its source.'],
];

const pipeline = [
  { number: '01', eyebrow: 'Discover', title: 'Find the evidence worth reading', copy: 'Region-aware agents identify scientific reports and datasets, acquire the source material, and preserve its provenance.', icon: FileSearch, detail: ['Source discovery', 'Document acquisition', 'Provenance capture'] },
  { number: '02', eyebrow: 'Understand', title: 'Turn documents into scientific structure', copy: 'Muse-assisted workflows extract observations, spatial references, tables, figures, limitations, and links back to original evidence.', icon: ScanSearch, detail: ['Feature extraction', 'Scientific observations', 'Evidence references'] },
  { number: '03', eyebrow: 'Experience', title: 'Generate an explorable study', copy: 'Validated evidence becomes a reusable rendering package: maps, profiles, charts, resources, and plain-language analysis.', icon: Orbit, detail: ['Adaptive UI schema', 'Capability selection', 'Spatial experience'] },
];

export function AboutPage() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => { const maximum = document.documentElement.scrollHeight - window.innerHeight; setProgress(maximum > 0 ? window.scrollY / maximum : 0); };
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <main className="about-page">
      <div className="about-progress" style={{ transform: `scaleX(${progress})` }} />
      <AboutNav />
      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero__atmosphere" />
        <div className="about-shell about-hero__content">
          <p className="about-kicker">Upamelm.ai · Our story</p>
          <h1 id="about-title">Maps show the surface.<br /><em>We reveal what lies beneath.</em></h1>
          <p className="about-hero__lede">An AI-powered scientific exploration platform for making the invisible systems beneath our cities understandable—and traceable to evidence.</p>
          <div className="about-hero__actions"><a href="/?city=bengaluru" className="about-button about-button--primary">Explore Bengaluru <ArrowRight /></a><a href="#story" className="about-button about-button--quiet">Descend into the story <ArrowDown /></a></div>
        </div>
        <EarthCutaway />
        <div className="about-hero__index" aria-hidden="true"><span>00</span><i /><span>06</span></div>
      </section>

      <section id="story" className="about-section about-section--invisible"><div className="about-shell about-two-col">
        <div className="about-sticky-copy reveal-on-scroll"><p className="about-kicker">The overlooked half of our world</p><h2>A city continues<br />below the street.</h2><p>Groundwater supports homes, farms, industry, and ecosystems. Aquifers store and transmit it. Soil and rock influence how cities grow and how infrastructure is built.</p><p className="about-emphasis">These systems shape everyday life—even when we never see them.</p></div>
        <SubsurfaceColumn />
      </div></section>

      <section className="about-section about-section--problem"><div className="about-shell">
        <div className="about-centered-heading reveal-on-scroll"><p className="about-kicker">The knowledge already exists</p><h2>The gap is not science.<br /><em>It is access.</em></h2><p>Government agencies and researchers have spent decades mapping aquifers, monitoring wells, and publishing rigorous studies. But much of that knowledge remains distributed across technical reports, specialist datasets, and professional tools.</p></div>
        <DocumentField />
        <div className="about-problem-bridge reveal-on-scroll"><Quote /><p>What does a 200-page aquifer report mean for <em>my city, my neighbourhood, my water?</em></p></div>
      </div></section>

      <section className="about-section about-section--answer"><div className="about-shell">
        <div className="about-answer-grid"><div className="reveal-on-scroll"><p className="about-kicker">Our response</p><h2>Scientific knowledge should be explorable.</h2></div><p className="about-answer-copy reveal-on-scroll">Upamelm.ai turns complex reports into spatial experiences that ordinary people can navigate—without severing the connection to the original scientific evidence.</p></div>
        <div className="about-principles">{principles.map(([number, title, copy]) => <article key={number} className="about-principle reveal-on-scroll"><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div>
      </div></section>

      <section id="pipeline" className="about-section about-section--pipeline"><div className="about-shell">
        <div className="about-pipeline-heading reveal-on-scroll"><p className="about-kicker">Built with Meta Muse Code</p><h2>From scattered documents<br />to a living evidence system.</h2><p>Our agentic pipeline is designed to be reused across locations and scientific domains—not rebuilt for every report.</p></div>
        <div className="about-pipeline">{pipeline.map((stage) => { const Icon = stage.icon; return <article key={stage.number} className="about-pipeline-stage reveal-on-scroll"><div className="about-pipeline-stage__rail"><span>{stage.number}</span><i /></div><div className="about-pipeline-stage__visual"><Icon /><div className="about-data-rain">{Array.from({ length: 10 }).map((_, index) => <i key={index} />)}</div></div><div className="about-pipeline-stage__copy"><p className="about-kicker">{stage.eyebrow}</p><h3>{stage.title}</h3><p>{stage.copy}</p><ul>{stage.detail.map((item) => <li key={item}><Check />{item}</li>)}</ul></div></article>; })}</div>
        <div className="about-truth-note reveal-on-scroll"><Sparkles /><p><strong>Muse helps us build the system and adapt its interfaces.</strong> Scientific claims still come from the source documents, with uncertainty and limitations preserved.</p></div>
      </div></section>

      <section className="about-section about-section--product"><div className="about-shell">
        <div className="about-product-heading reveal-on-scroll"><div><p className="about-kicker">Working today · Bengaluru</p><h2>One report becomes<br />many ways to understand.</h2></div><p>Five groundwater and aquifer studies are available through a single evidence workspace. Users can move from regional context to individual observations, report analysis, charts, tables, and depth-aware views where the evidence supports them.</p></div>
        <ProductFrame />
        <div className="about-guardrail reveal-on-scroll"><span>Measured</span><i /><span>Derived</span><i /><span>Illustrative</span><p>We distinguish what was observed, what was interpreted, and what is only a visual aid. No reported depth means no invented underground geometry.</p></div>
      </div></section>

      <section className="about-section about-section--vision"><IndiaVision /><div className="about-shell about-vision-copy reveal-on-scroll"><p className="about-kicker">Bengaluru is the beginning</p><h2>Imagine scientific knowledge<br />you can step inside.</h2><p>Groundwater and aquifers come first. Over time, the same evidence-first approach could help people understand geology, soil, underground infrastructure, and other subsurface systems—where reliable data exists.</p></div></section>

      <section className="about-finale"><div className="about-shell reveal-on-scroll"><p className="about-kicker">The surface is only the beginning</p><h2>Make the invisible<br /><em>understandable.</em></h2><a href="/?city=bengaluru" className="about-button about-button--primary">Enter Upamelm.ai <ArrowRight /></a></div><div className="about-finale__strata" aria-hidden="true">{Array.from({ length: 7 }).map((_, index) => <i key={index} />)}</div></section>
      <footer className="about-footer"><div className="about-shell"><Brand /><p>Built for the Meta AI Developer Hackathon with Meta Muse Code.</p><a href="#about-title">Back to surface ↑</a></div></footer>
      <RevealController />
    </main>
  );
}

function AboutNav() { return <header className="about-nav"><div className="about-shell"><a href="/" aria-label="Upamelm.ai home"><Brand /></a><nav aria-label="About page navigation"><a href="#story">Why</a><a href="#pipeline">How it works</a><a href="/?city=bengaluru" className="about-nav__cta">Open explorer <ArrowRight /></a></nav></div></header>; }
function Brand() { return <span className="about-brand"><span><Box /></span><b>Upamelm.ai</b><small>Maps to What's Underneath</small></span>; }
function EarthCutaway() { return <div className="earth-cutaway" aria-hidden="true"><div className="earth-cutaway__city"><i /><i /><i /><i /><i /><span /></div><div className="earth-cutaway__surface" /><div className="earth-cutaway__layers">{Array.from({ length: 7 }).map((_, index) => <i key={index} />)}</div><div className="earth-cutaway__aquifer"><span>AQUIFER</span></div><div className="earth-cutaway__well" /><div className="earth-cutaway__scan" /></div>; }
function SubsurfaceColumn() { const layers = [['00 m', 'The visible city'], ['03–33 m', 'Weathered zone'], ['33–210 m', 'Fractured rock'], ['—', 'Evidence varies by location']]; return <div className="subsurface-column reveal-on-scroll">{layers.map(([depth, name], index) => <div key={name} className={`subsurface-column__layer layer-${index}`}><span>{depth}</span><b>{name}</b>{index === 1 && <i className="subsurface-column__water" />}</div>)}<div className="subsurface-column__bore"><i /><span>Example profile range from the current Bengaluru study</span></div></div>; }
function DocumentField() { return <div className="document-field reveal-on-scroll"><div className="document-field__reports">{['Aquifer maps', 'Ground water year book', 'Resource assessment', 'Water quality', 'Management plan'].map((title, index) => <div key={title} style={{ '--report-index': index } as React.CSSProperties}><span>CGWB · TECHNICAL REPORT</span><b>{title}</b><i /><i /><i /><small>{48 + index * 37} pages</small></div>)}</div><div className="document-field__gap"><ArrowRight /></div><div className="document-field__question"><span>?</span><p>Dense evidence.<br />Limited entry points.</p></div></div>; }
function ProductFrame() { return <div className="product-frame reveal-on-scroll"><div className="product-frame__bar"><span><i /><i /><i /></span><b>Upamelm.ai · Bengaluru</b><small>LIVE PRODUCT VIEW</small></div><div className="product-frame__body"><aside><span><Map /> Map view</span><span><Layers3 /> 3D profiles</span><span><BookOpen /> Analysis</span><div /><small>ACTIVE STUDY</small><b>Bangalore North Aquifer Plan</b></aside><div className="product-frame__map"><div className="product-frame__boundary">{Array.from({ length: 8 }).map((_, index) => <i key={index} style={{ '--point-index': index } as React.CSSProperties} />)}</div><div className="product-frame__map-label"><span>79° E</span><b>BENGALURU</b><span>13° N</span></div><div className="product-frame__panel"><small>DOCUMENT ANALYSIS</small><b>Thin rock. Heavy pumping. A way back.</b><p>Evidence-backed findings, metrics, and original references remain connected.</p><div><span>8 findings</span><span>12 resources</span><span>19 charts</span></div></div></div></div></div>; }
function IndiaVision() { return <div className="india-vision" aria-hidden="true"><div className="india-vision__outline">INDIA</div>{[['Bengaluru', '68%', '66%'], ['Delhi', '48%', '31%'], ['Future', '38%', '47%'], ['Future', '58%', '45%']].map(([name, left, top], index) => <i key={`${name}-${index}`} style={{ left, top }} className={index ? '' : 'is-live'}><span>{name}</span></i>)}</div>; }
function RevealController() { const observer = useRef<IntersectionObserver | null>(null); useEffect(() => { observer.current = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')), { threshold: 0.15 }); document.querySelectorAll('.reveal-on-scroll').forEach((element) => observer.current?.observe(element)); return () => observer.current?.disconnect(); }, []); return null; }
