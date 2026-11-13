import { Portrait } from "../../components/Portrait";
import { Header } from "../../components/ui";
import { CONTRIBUTORS } from "../../lib/contributors";

export default function ContributorsPage() {
  return (
    <>
      <Header eyebrow="Team" title="Contributors" lede="The people behind this research project." />
      <div className="grid cols-4">
        {CONTRIBUTORS.map((c) => (
          <div key={c.name} className="tile lift person">
            <Portrait src={c.image} name={c.name} />
            <h3>{c.link ? <a href={c.link} target="_blank" rel="noreferrer">{c.name}</a> : c.name}</h3>
            {c.studentId && <span className="faint">Student ID {c.studentId}</span>}
            {c.role && <span className="muted">{c.role}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
