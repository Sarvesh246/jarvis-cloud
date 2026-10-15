import { useEffect, useState } from "react";

/* A phone, or a phone turned on its side: where Vaelo uses its own small-
   screen design rather than a narrowed desktop. */
export const PHONE = "(max-width: 47.9375rem), (pointer: coarse) and (max-height: 31.25rem)";

export function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE).matches);
  useEffect(() => {
    const query = matchMedia(PHONE);
    const change = () => setPhone(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return phone;
}
