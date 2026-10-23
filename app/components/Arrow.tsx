export default function Arrow({left=false}:{left?:boolean}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={left?{transform:"rotate(180deg)"}:undefined}><path d="M4 12h16M14 6l6 6-6 6"/></svg>;
}
