/* iOS leaves the page its full height when the keyboard rises and scrolls the
   page up instead, which hides the header or the message box. Follow the
   visible area: while the keyboard is up the app is exactly that tall, so the
   composer sits on top of the keyboard and nothing is pushed out of view. */
const KEYBOARD = 120;

export function trackViewport() {
  const view = window.visualViewport;
  if (!view || !matchMedia("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const open = window.innerHeight - view.height > KEYBOARD;
    if (open) {
      root.style.setProperty("--app-h", `${Math.round(view.height)}px`);
      root.dataset.keyboard = "";
      if (view.offsetTop || window.scrollY) window.scrollTo(0, 0);
    } else {
      root.style.removeProperty("--app-h");
      delete root.dataset.keyboard;
    }
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  view.addEventListener("resize", queue);
  view.addEventListener("scroll", queue);
  apply();
}
