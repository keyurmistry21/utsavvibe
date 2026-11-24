import Link from "next/link";
import { brand, celebrate, faq, family, heroSlides, prebook, showcases, testimonials, why } from "@/lib/brand";
import { HeroSlider } from "./HeroSlider";

const Heading = ({ parts, accent = 0, tag: Tag = "h2" }: { parts: string[]; accent?: number; tag?: "h1" | "h2" }) => (
  <Tag className="th-title">{parts.map((p, i) => <span key={i} className={i === accent ? "acc" : ""}>{p} </span>)}</Tag>
);

export function Hero({ market }: { market: string }) {
  return <HeroSlider slides={heroSlides.map((x) => ({ ...x, href: `/${market}${x.href}` }))} phone={brand.phone} phoneHref={brand.phoneHref} />;
}

export function PreBook({ market }: { market: string }) {
  return (
    <section className="th-sec th-prebook">
      <Heading parts={prebook.title} />
      <p className="th-lead">{prebook.text}</p>
      <div className="th-addr">
        {brand.addresses.map((a, i) => (
          <div key={i} className="th-addr-card">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z" /></svg>
            <p>{a.lines.join(" ")}</p>
            {a.note && <p className="small">{a.note}</p>}
          </div>
        ))}
      </div>
      <div className="th-cards2">
        {prebook.cards.map((c) => (
          <div key={c.title} className="th-card2">
            <img src={c.image} alt={c.title} width={285} height={285} loading="lazy" />
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <Link className="th-ribbon" href={`/${market}${c.href}`}>{c.button}</Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Why() {
  return (
    <section className="th-sec th-why">
      <h2 className="th-title"><span>{why.title[0]} </span><span className="acc">{why.title[1]} </span><span>{why.title[2]}</span></h2>
      <p className="th-lead strong">{why.sub}</p>
      <p className="th-lead">{why.text}</p>
      <div className="th-why-grid">
        {why.items.map((i) => (
          <div key={i.title} className="th-bevel th-why-card">
            <img src={i.image} alt="" width={100} height={100} loading="lazy" />
            <h3>{i.title}</h3>
            <p>{i.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Showcases({ market }: { market: string }) {
  return (
    <>
      {showcases.map((s) => (
        <section key={s.title.join()} className={`th-show ${s.tint ? "tint" : ""} ${s.reverse ? "rev" : ""}`}>
          <div className="th-show-in">
            <div className="th-show-imgs">
              <img className="big th-bevel" src={s.images[0]} alt="" width={500} height={500} loading="lazy" />
              <div className="small">
                <img className="th-bevel" src={s.images[1]} alt="" width={250} height={250} loading="lazy" />
                <img className="th-bevel" src={s.images[2]} alt="" width={250} height={250} loading="lazy" />
              </div>
            </div>
            <div className="th-show-copy">
              <p className="th-sub">{s.small}</p>
              <h2 className="th-title"><span className="acc">{s.title[0]} </span><span>{s.title[1]}</span></h2>
              <p className="th-text">{s.text}</p>
              <Link className="tbtn" href={`/${market}${s.href}`}>{s.button}</Link>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

export function Family({ ig }: { ig: { id: string; permalink: string; image: string; caption: string }[] }) {
  return (
    <section className="th-sec th-family">
      <h2 className="th-title"><span>{family.title[0]} </span><span className="acc">{family.title[1]}</span></h2>
      <p className="th-lead">{family.text}</p>
      {ig.length > 0 ? (
        <div className="igrid">
          {ig.slice(0, 6).map((p) => (
            <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer noopener" aria-label={p.caption || "Instagram post"}>
              <img src={p.image} alt={p.caption || "Instagram post"} width={300} height={300} loading="lazy" referrerPolicy="no-referrer" />
            </a>
          ))}
        </div>
      ) : (
        <img className="th-family-img" src="/theme/ganesha-family-image.webp" alt="" width={640} height={360} loading="lazy" />
      )}
      <a className="tbtn" href={brand.instagram} target="_blank" rel="noreferrer noopener">{family.button}</a>
    </section>
  );
}

export function Celebrate({ market }: { market: string }) {
  return (
    <section className="th-sec th-celebrate">
      <h2 className="th-title">{celebrate.title}</h2>
      <p className="th-lead">{celebrate.text}</p>
      <Link className="tbtn" href={`/${market}${celebrate.href}`}>{celebrate.button}</Link>
    </section>
  );
}

export function Testimonials() {
  return (
    <section className="th-sec th-testi">
      <h2 className="th-title"><span>{testimonials.title[0]} </span><span className="acc">{testimonials.title[1]}</span></h2>
      <p className="th-lead">{testimonials.text}</p>
      <div className="th-testi-grid">
        {testimonials.items.map((t) => (
          <figure key={t.author} className="th-bevel th-testi-card">
            <blockquote>{t.quote}</blockquote>
            <figcaption>- {t.author}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="th-faq">
      <div className="th-faq-in">
        <h2 className="th-title"><span className="acc">{faq.title[0]} </span><span>{faq.title[1]}</span></h2>
        <p className="th-lead left">{faq.text}</p>
        <div className="th-faq-list">
          {faq.items.map((f, i) => (
            <details key={f.q} className="th-bevel" open={i === 0}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
