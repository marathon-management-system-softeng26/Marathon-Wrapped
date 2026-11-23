export default function StoryProgress({ current, count, labels, onSelect }: { current: number; count: number; labels: readonly string[]; onSelect: (index: number) => void }) {
  return <nav className="story-tabs" aria-label="Recap pages">{Array.from({ length: count }, (_, index) => <button key={labels[index] ?? index} aria-current={current === index ? "step" : undefined} onClick={() => onSelect(index)}><span className={index <= current ? "filled" : ""} /><small>{labels[index] ?? `Page ${index + 1}`}</small></button>)}</nav>;
}
