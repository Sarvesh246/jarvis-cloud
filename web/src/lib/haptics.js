/* A short tap under the finger for the things a phone should feel: send, a
   reply finishing, the drawer settling, a toggle. Browsers without a vibration
   motor (iOS Safari, desktops) simply do nothing. */
export function buzz(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* a missing nicety, not a problem */
  }
}
