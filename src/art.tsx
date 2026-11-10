// Hand-drawn mountain art for Tandem. Inline SVG only, no images.

export function PeakMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 28 20" aria-hidden="true">
      <path d="M2 18 10 6l4.5 6L18 7l8 11Z" fill="currentColor" opacity=".18" />
      <path d="M2 18 10 6l4.5 6L18 7l8 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8.2 8.7 1.8-2.7 1.9 2.6" fill="none" stroke="#e8945a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RidgeDivider() {
  return (
    <svg className="ridge-divider" viewBox="0 0 1200 36" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 30 L120 20 L200 26 L320 10 L420 24 L520 16 L640 28 L760 8 L880 22 L980 14 L1100 26 L1200 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// Soft, layered ranges at dusk. Used as a background band (hero, auth).
export function Ridges({ className = "" }: { className?: string }) {
  return (
    <svg className={`ridges ${className}`} viewBox="0 80 1440 280" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="r-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f6efe6" stopOpacity="0" />
          <stop offset="1" stopColor="#f3e6d6" stopOpacity=".7" />
        </linearGradient>
        <linearGradient id="r-far" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c9d6e8" />
          <stop offset="1" stopColor="#dfe6ee" />
        </linearGradient>
        <linearGradient id="r-mid" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#8fae9f" />
          <stop offset="1" stopColor="#a9c2b6" />
        </linearGradient>
        <linearGradient id="r-near" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3f6b59" />
          <stop offset="1" stopColor="#2f5d4a" />
        </linearGradient>
      </defs>
      <rect width="1440" height="360" fill="url(#r-sky)" />
      <circle cx="1080" cy="120" r="34" fill="#e8945a" opacity=".22" />
      <path d="M0 230 L90 196 L170 214 L260 150 L330 182 L420 118 L500 168 L590 140 L680 186 L780 104 L860 150 L950 128 L1040 170 L1130 112 L1220 160 L1320 134 L1440 172 V360 H0Z" fill="url(#r-far)" />
      <path d="M780 104 L800 120 L792 122 L808 136 L780 124 Z M420 118 L436 132 L426 133 L440 146 L418 134Z" fill="#fff" opacity=".7" />
      <path d="M0 270 L110 236 L210 258 L320 206 L420 244 L540 198 L640 240 L760 210 L880 252 L990 214 L1110 248 L1230 220 L1340 250 L1440 232 V360 H0Z" fill="url(#r-mid)" opacity=".9" />
      <path d="M0 318 L140 286 L260 304 L400 270 L520 300 L660 276 L800 306 L940 280 L1080 308 L1220 284 L1340 302 L1440 290 V360 H0Z" fill="url(#r-near)" />
      <g fill="#24493a">
        <path d="M188 300 l8-22 8 22Z M204 304 l6-16 6 16Z M1166 296 l9-24 9 24Z M1184 300 l6-17 6 17Z M612 288 l7-19 7 19Z" />
      </g>
    </svg>
  );
}

// Faint topographic lines for texture.
export function Contours({ className = "" }: { className?: string }) {
  return (
    <svg className={`contours ${className}`} viewBox="0 0 600 400" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M300 60c90 0 170 50 170 130s-80 150-170 150-180-60-180-140S210 60 300 60Z" />
        <path d="M300 95c70 0 130 38 130 98s-62 112-130 112-138-46-138-104S232 95 300 95Z" />
        <path d="M300 130c48 0 90 26 90 66s-42 76-90 76-94-30-94-70 46-72 94-72Z" />
        <path d="M300 165c26 0 48 14 48 34s-22 40-48 40-50-16-50-36 24-38 50-38Z" />
        <path d="M-20 330c120-40 220 30 330 10s200-90 320-60" />
        <path d="M-20 365c130-36 240 32 350 12s190-80 300-52" />
      </g>
    </svg>
  );
}

// A small, honest picture of the product: a workspace with two people and the AI working.
export function WorkspaceMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock__bar">
        <span className="mock__dots"><i /><i /><i /></span>
        <span className="mock__title">Yosemite weekend</span>
        <span className="mock__people"><b style={{ background: "#e8945a" }}>M</b><b style={{ background: "#5f8fd6" }}>J</b><b style={{ background: "#2f5d4a" }}>S</b></span>
      </div>
      <div className="mock__body">
        <div className="mock__files">
          <span className="mock__label">Files</span>
          <span className="on">itinerary.md</span>
          <span>packing.md</span>
          <span>budget.md</span>
          <span>campsites.pdf</span>
        </div>
        <div className="mock__main">
          <div className="mock__msg"><b style={{ color: "#a4521b" }}>Maya</b> Find a campsite near Tuolumne for Saturday and add it to the itinerary</div>
          <div className="mock__plan">
            <span className="done">✓ Checked recreation.gov for open sites</span>
            <span className="now">● Comparing Tuolumne vs. Porcupine Flat</span>
            <span>○ Update itinerary.md</span>
          </div>
          <div className="mock__browser">
            <div className="mock__url">recreation.gov/camping/tuolumne-meadows</div>
            <div className="mock__page"><i /><i /><i className="short" /></div>
          </div>
          <div className="mock__reply">Tuolumne Meadows has 3 open sites Sat night. I added it to <u>itinerary.md</u>.</div>
          <div className="mock__input"><span>Ask the AI… </span><em>Sonnet 5.5 ▾</em></div>
        </div>
      </div>
    </div>
  );
}

export function TripIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 25 12 10l5 7 4-5 8 13Z" fill="currentColor" opacity=".15" /><path d="M3 25 12 10l5 7 4-5 8 13M3 25h26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function SchoolIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m4 12 12-6 12 6-12 6L4 12Zm5 3v7c4 3 10 3 14 0v-7M28 13v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function BuildIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m13 8-7 8 7 8M19 8l7 8-7 8M18 5l-4 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
