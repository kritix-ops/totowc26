import Script from "next/script";

// A stranded mobile client (an installed PWA, or a tab whose service worker
// cached an older build) can be handed HTML that points at `/_next/static`
// chunks the current deploy has already deleted. One 404 on a chunk kills the
// whole React root: hydration never completes, so the server-rendered
// SplashOverlay never gets its `useEffect` to fade out and the app looks
// "stuck loading" while nothing (autosave included) can run.
//
// A React component can't fix this, because its effect only mounts *after*
// hydration, the very thing that failed. So this recovery runs as a
// `beforeInteractive` inline script: Next.js hoists it into <head> and runs
// it before any first-party module, so its listeners are already attached
// when a chunk 404s. On such a failure it reloads once, which re-fetches the
// (network-first) HTML and its fresh chunk URLs. A short time-based guard in
// sessionStorage stops a genuinely broken deploy from looping.
//
// Depends on CSP staying unset (see next.config.ts) so the inline script may
// run without a nonce. Revisit together with the CSP hardening pass.
const RECOVERY = `(function(){
  var KEY="__toto_chunk_reload__";
  function isChunk(u){return typeof u==="string"&&u.indexOf("/_next/static/")!==-1;}
  function recover(){
    try{
      var now=Date.now();
      var last=parseInt(sessionStorage.getItem(KEY)||"0",10);
      if(now-last<10000)return;
      sessionStorage.setItem(KEY,String(now));
    }catch(e){}
    window.location.reload();
  }
  // Only a failed JS chunk kills hydration (the "stuck loading" symptom).
  // A missing stylesheet or font renders an ugly-but-working page, so those
  // are deliberately left alone rather than triggering a reload.
  window.addEventListener("error",function(e){
    var t=e&&e.target;
    if(t&&t.tagName==="SCRIPT"&&isChunk(t.src))recover();
  },true);
  window.addEventListener("unhandledrejection",function(e){
    var r=e&&e.reason;
    var m=(r&&(r.message||String(r)))||"";
    if(m.indexOf("dynamically imported module")!==-1||m.indexOf("ChunkLoadError")!==-1||m.indexOf("Importing a module script failed")!==-1)recover();
  });
})();`;

export function ChunkRecoveryScript() {
  return (
    // The lint rule below is a Pages-Router holdover: it flags any
    // `beforeInteractive` script not living in `pages/_document.js`. This app
    // is App Router, where the Next docs require `beforeInteractive` to sit in
    // the root layout (this component's only mount point), so the warning is
    // a false positive and `beforeInteractive` is precisely what we need to
    // attach the listeners before the first chunk can fail.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script id="toto-chunk-recovery" strategy="beforeInteractive">
      {RECOVERY}
    </Script>
  );
}
