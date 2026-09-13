import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      {/* Soft drifting hearts for atmosphere */}
      <div className="petals" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className={`petal petal-${i + 1}`}>
            ♥
          </span>
        ))}
      </div>

      <section className="home-stage">
        <p className="home-eyebrow">to us</p>

        <h1 className="home-title">
          Happy
          <em>Anniversary</em>
        </h1>

        {/* The beating heart — the centerpiece */}
        <div className="heart-wrap" aria-hidden="true">
          <svg
            className="heart"
            viewBox="0 0 32 29.6"
            role="presentation"
            focusable="false"
          >
            <path d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z" />
          </svg>
          <span className="heart-glow" />
        </div>

        <Link href="/ar" className="tap">
          <span className="tap-heart">♥</span>
          Tap me
        </Link>
      </section>
    </main>
  );
}
