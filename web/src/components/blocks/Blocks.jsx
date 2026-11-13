import React, { lazy, Suspense } from "react";
export { PresentationContext, useCopy, useSources, looksLikeSvg, SourceStrip, imageTiles, download } from "./block-helpers.jsx";
const ReplyRenderer = lazy(() => import("./ReplyRenderer.jsx").then(module => ({ default: module.Rendered })));
export function Rendered(props) {
  return <Suspense fallback={<pre className="block-plain">{props.content}</pre>}><ReplyRenderer {...props} /></Suspense>;
}
