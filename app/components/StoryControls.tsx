import Arrow from "./Arrow";
export default function StoryControls({ current, count, onPrevious, onNext }: { current: number; count: number; onPrevious: () => void; onNext: () => void }) {
  return <footer className="story-controls"><button className="circle" aria-label="Previous page" onClick={onPrevious} disabled={current === 0}><Arrow left /></button><span>{current + 1} / {count}</span><button className="circle" aria-label="Next page" onClick={onNext} disabled={current === count - 1}><Arrow /></button></footer>;
}
