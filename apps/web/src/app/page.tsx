export default function HomePage(): React.JSX.Element {
  return (
    <main>
      <section className="panel">
        <p className="status">Platform foundation is running</p>
        <h1>Tender Intelligence Platform</h1>
        <p>
          The production monorepo and local infrastructure foundation are ready.
          Business workflows and authentication are intentionally not included
          in this phase.
        </p>
        <p className="disclaimer">
          Tender Intelligence Platform is independent and is not affiliated
          with, endorsed by, or operated by Government e-Marketplace (GeM),
          CPPP, or any government authority. It does not guarantee eligibility,
          submission, award, or bid success.
        </p>
      </section>
    </main>
  );
}
