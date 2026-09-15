/** Small technical illustrations for the object manifest. */
export function ObjectGlyph({ id }: { id: string }) {
  return <svg viewBox="0 0 100 54" className="object-glyph" aria-hidden="true" fill="none">
    <ellipse cx="49" cy="45" rx="28" ry="3" fill="#253829" opacity=".07" />
    {id === "sponge" ? <>
      <path d="m22 21 38-6 18 9-39 7z" fill="#e2ce78" /><path d="m22 21 17 10v12L22 32z" fill="#b99e4b" /><path d="m39 31 39-7v13l-39 6z" fill="#d1b65a" />
      <path d="m22 19 38-6 18 8v4l-39 7-17-10z" fill="#617d51" /><path d="m25 19 35-5 13 6-35 6z" fill="#799467" />
      {[43, 51, 60, 70].map((x, i) => <circle key={x} cx={x} cy={34 - i} r="1.3" fill="#b09743" />)}
    </> : null}
    {id === "tape_holder" ? <>
      <path d="m22 36 49-2 10 7-52 5z" fill="#56645a" /><ellipse cx="49" cy="27" rx="23" ry="15" fill="#bd9d75" /><path d="M26 27v6c0 8 46 8 46-6v-1" fill="#a98c68" /><ellipse cx="49" cy="25" rx="23" ry="14" fill="#d7c6a4" /><ellipse cx="49" cy="25" rx="12" ry="7" fill="#6f7461" /><path d="M37 25c3-8 21-8 24 0" stroke="#f2e7cc" strokeWidth="2" /><path d="m67 31 13 5v5l-17-7" fill="#83917d" />
    </> : null}
    {id === "marker" ? <>
      <g transform="rotate(-18 50 28)"><rect x="19" y="23" width="61" height="10" rx="5" fill="#466c84" /><rect x="36" y="23" width="20" height="10" fill="#eceddf" /><path d="M38 25h15m-15 2h9" stroke="#a4b0a4" strokeWidth="1" /><rect x="63" y="22" width="20" height="12" rx="4" fill="#263f4b" /><path d="M65 23h14" stroke="#6e858b" strokeWidth="2" /><path d="M23 25h11" stroke="#7599a7" /></g>
    </> : null}
    {id === "egg" ? <>
      <path d="M69 29c0 11-10 16-21 14S29 34 32 24 44 9 50 10s20 8 19 19Z" fill="#d8c4a2" /><path d="M50 10c-11 0-20 11-18 18s10 12 17 10 17-10 14-17S55 10 50 10Z" fill="#e8d8bb" /><path d="M39 23c1-5 5-8 9-9" stroke="#f7edd7" strokeWidth="3" strokeLinecap="round" />
      {[[54, 32], [59, 25], [43, 30], [52, 20]].map(([x,y]) => <circle key={x} cx={x} cy={y} r=".65" fill="#bea984" />)}
    </> : null}
  </svg>;
}
