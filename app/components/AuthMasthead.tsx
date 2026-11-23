export default function AuthMasthead({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`auth-masthead${compact ? " auth-masthead-compact" : ""}`}>
      <div className="auth-masthead-photo" aria-hidden="true" />
      <div className="auth-masthead-content">
        <h1>
          <span>Soekarno</span>{" "}
          <b>Run</b>{" "}
          <em>2027</em>
        </h1>
        <p>Your race, in numbers, photos and one good memory.</p>
      </div>
    </section>
  );
}
