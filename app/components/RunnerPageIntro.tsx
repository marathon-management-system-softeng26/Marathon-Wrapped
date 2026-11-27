import Link from "next/link";

export default function RunnerPageIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="runner-page-intro">
      <Link className="runner-back-link" href="/" prefetch={false}>← Your races</Link>
      <h1 className="page-title">{title}</h1>
      <p>{description}</p>
    </header>
  );
}
