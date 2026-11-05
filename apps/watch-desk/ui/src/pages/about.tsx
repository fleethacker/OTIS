import type { RouteMeta } from "../route-registry";
import patch from "../assets/otis/otis-patch.webp";
import plexLicense from "../assets/fonts/ibm-plex-mono/LICENSE.txt" with { type: "file" };

export const route: RouteMeta = { path: "/about", label: "About OTIS", order: 30 };

export default function About() {
  return (
    <section className="about-otis" aria-labelledby="about-otis-title">
      <div className="about-otis-art">
        <img
          src={patch}
          width={800}
          height={800}
          alt="OTIS the sea otter standing watch in a navy cap and headset, holding a schedule clipboard"
        />
      </div>
      <div className="about-otis-copy">
        <p className="about-otis-eyebrow">Keeping the Watch</p>
        <h1 id="about-otis-title">About OTIS</h1>
        <p className="about-otis-name">Operational Tasking Integration System</p>
        <p>
          OTIS turns naval message traffic into organized tasking and a shared operational timeline.
          Search messages, review extracted events, and trace the schedule back to its source.
        </p>
        <p>
          Meet OTIS, our watchstanding sea otter. Cap on, headset ready, keeping an eye on what
          comes next.
        </p>
        <p>
          Operational readouts use IBM Plex Mono. <a href={plexLicense}>Font license</a>
        </p>
      </div>
    </section>
  );
}
