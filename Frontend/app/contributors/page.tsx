import { Header } from "../../components/ui";
import { CONTRIBUTORS } from "../../lib/contributors";

function Portrait({ src, name }: { src?: string; name: string }) {
  if (src) return <img className="portrait" src={src} alt={name} width={132} height={132} />;
  return (
    <div className="portrait" aria-label="Photo coming soon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
    </div>
  );
}

export default function ContributorsPage() {
  return (
    <>
      <Header eyebrow="Team" title="Contributors" lede="The people behind this research project." />
      <div className="grid cols-4">
        {CONTRIBUTORS.map((c, i) => (
          <div key={i} className="tile lift person">
            <Portrait src={c.image} name={c.name} />
            <h3>{c.link ? <a href={c.link} target="_blank" rel="noreferrer">{c.name}</a> : c.name}</h3>
            <span className="muted">{c.role}</span>
          </div>
        ))}
      </div>
    </>
  );
}
