"use client";

import { useEffect, useState } from "react";

const steps = ["Your race", "Distance", "Splits", "Hydration", "Photos", "Share"];
// Demonstration data only. Replace with the runner result returned by the API.
const race = { bib: "1234", distance: 10, splits: [310, 305, 300, 299, 292, 287, 283, 280, 264, 269] };
const elapsed = race.splits.reduce((sum, split) => sum + split, 0);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const fastest = Math.min(...race.splits);

export default function Home() {
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState("");
  const [photo, setPhoto] = useState<number | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhoto(null);
      if (photo !== null || event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowRight") setStep(value => Math.min(5, value + 1));
      if (event.key === "ArrowLeft") setStep(value => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [photo]);
  function saveImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setNotice("Image export is unavailable in this browser."); return; }
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, "#c73546"); gradient.addColorStop(1, "#60191d");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#faf6eb"; ctx.fillRect(140, 230, 800, 850);
    ctx.fillStyle = "#b93142"; ctx.font = "bold 40px Arial"; ctx.fillText("MARATHON WRAPPED", 205, 335);
    ctx.font = "bold 180px Arial"; ctx.fillText("10.0", 205, 555); ctx.fillText("km", 205, 745);
    ctx.font = "bold 42px Arial"; ctx.fillText(`${time(elapsed)} · JAKARTA 2027`, 205, 885);
    ctx.fillText(`${time(Math.round(elapsed / race.distance))} average pace /km`, 205, 965);
    ctx.fillStyle = "#faf6eb"; ctx.font = "30px Arial"; ctx.fillText("Soekarno Run 2027 · Sample recap", 205, 1190);
    canvas.toBlob(blob => {
      if (!blob) { setNotice("Unable to create image. Please try again."); return; }
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `marathon-wrapped-${race.bib}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Your recap image is saved.");
    }, "image/png");
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice("Demo link copied. This link opens the sample recap."); }
    catch { setNotice("Could not copy the link. Copy the address from your browser."); }
  }
  return (
    <main className="experience">
      <article className={`story story-${step}`} aria-label="Soekarno Run race recap">
        <nav className="progress" aria-label="Recap screens">{steps.map((name, index) => <button key={name} aria-label={name} aria-current={step === index ? "step" : undefined} onClick={() => { setStep(index); setNotice(""); }} className={index <= step ? "complete" : ""} />)}</nav>
        <div className="screen" key={step}>
          {step === 0 && <><p className="eyebrow">Soekarno Run 2027</p><div className="intro-art" aria-hidden="true"><span>2027</span><svg viewBox="0 0 240 280"><circle cx="133" cy="42" r="23"/><path d="m104 83 51 4 28 60-23 11-26-43-21 58 39 35-24 66-26-9 16-45-45-31-31 43-26-17 49-67 17-45-39 19-10-22z"/></svg></div><div className="intro-copy"><h1><em>You ran</em><br/>the whole<br/>thing.</h1><p>Your race, in numbers, photos<br/>and one very good finish.</p></div></>}
          {step === 1 && <><p className="eyebrow">Distance</p><h1 className="distance">10.0<span>km</span></h1><div className="stats"><div><strong>{time(elapsed)}</strong><span>Finish time</span></div><div><strong>{time(Math.round(elapsed / race.distance))}</strong><span>Avg pace /km</span></div></div><p className="accent-note">Every kilometer counts.<br/>You made it to the finish line.</p></>}
          {step === 2 && <><p className="eyebrow">Splits</p><h1>You saved<br/>your best for last.</h1><div className="split-panel"><div className="bars" role="img" aria-label={race.splits.map((s,i) => `Kilometer ${i+1}: ${time(s)}`).join(", ")}>{race.splits.map((s,i) => <div key={i} className={s === fastest ? "fastest" : ""} style={{height: `${40 + (310-s)*1.15}%`}}><span>{i+1}</span></div>)}</div><p>Fastest: km {race.splits.indexOf(fastest)+1} at {time(fastest)}</p></div><p className="supporting">Your second half was {time(race.splits.slice(0,5).reduce((a,b)=>a+b,0)-race.splits.slice(5).reduce((a,b)=>a+b,0))} faster.</p></>}
          {step === 3 && <><p className="eyebrow">Hydration</p><h1>You stayed<br/>hydrated all<br/>the way.</h1><div className="stations">{[2,4,6,8].map(km => <div key={km}><i className={km === 6 ? "skipped" : ""}/><b>km {km}</b><span>{km === 6 ? "Skipped" : "Visited"}</span></div>)}</div><div className="stats"><div><strong>3 / 4</strong><span>Stations visited</span></div><div><strong>~254 ml</strong><span>Amount consumed</span></div></div><p className="accent-note">You skipped the km 6 water station and held your pace along the way.</p><small>Sample hydration data · estimated consumption</small></>}
          {step === 4 && <><h1>Caught<br/>in the moment.</h1><div className="gallery">{[9,2,4,6,7,3].map((km,i) => <button className={`photo photo-${i}`} key={km} onClick={() => setPhoto(i)} aria-label={`Open sample photo placeholder at kilometer ${km}`}><span>km {km}</span></button>)}</div><p className="photo-caption">6 sample placeholders for bib #{race.bib}</p></>}
          {step === 5 && <><p className="eyebrow">Share</p><div className="year" aria-hidden="true">2027</div><div className="share-card"><p>Marathon Wrapped</p><h1>10.0<br/>km</h1><p>{time(elapsed)} · Jakarta 2027</p><p>{time(Math.round(elapsed / race.distance))} Avg pace /km</p></div><div className="share-actions"><button onClick={saveImage}>Save image</button><button onClick={copyLink}>Copy demo link</button></div><p className="notice" role="status">{notice}</p></>}
        </div>
        <footer className="story-footer"><button aria-label="Previous screen" disabled={step === 0} onClick={() => { setStep(step-1); setNotice(""); }}>←</button><span>{step+1} / 6</span><button aria-label={step === 5 ? "Restart recap" : "Next screen"} onClick={() => { setStep(step === 5 ? 0 : step+1); setNotice(""); }}>{step === 5 ? "↻" : "→"}</button></footer>
      </article>
      <p className="demo-label">Marathon Wrapped · Sample recap</p>
      {photo !== null && <div className="modal" role="dialog" aria-modal="true" aria-label="Sample race photo" onClick={() => setPhoto(null)}><div onClick={e => e.stopPropagation()}><button className="close" autoFocus onClick={() => setPhoto(null)} aria-label="Close photo">×</button><div className={`photo photo-${photo} enlarged`}/><p>Sample placeholder · race photos are not connected yet.</p></div></div>}
    </main>
  );
}
