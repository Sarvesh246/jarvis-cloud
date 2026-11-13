import React from "react";

// Snapshot only the streaming-to-settled boundary. Ordinary token updates do
// not measure or clone the reply. The short, local size transition keeps a
// completed card from cutting across text the person is reading.
export class ReplyTransition extends React.Component {
  node = React.createRef();
  animations = [];
  ghost = null;
  timer = null;
  reduced() {
    return document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  getSnapshotBeforeUpdate(previous) {
    if (!previous.live || this.props.live || !this.node.current || this.reduced()) return null;
    const node = this.node.current;
    return { height: node.getBoundingClientRect().height, ghost: node.cloneNode(true) };
  }
  componentDidUpdate(previous, _, snapshot) {
    if (!snapshot) { if (this.props.live) this.cancel(); return; }
    this.cancel();
    const node = this.node.current;
    if (!node?.animate) return;
    const height = node.getBoundingClientRect().height;
    const children = [...node.children];
    const ghost = snapshot.ghost;
    ghost.className = "reply-before";
    ghost.setAttribute("aria-hidden", "true"); ghost.setAttribute("inert", "");
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    node.appendChild(ghost); this.ghost = ghost;
    const options = { duration: 180, easing: "ease-out" };
    // Large replies use a fade only, avoiding layout animation across a long
    // document. Common short card conversions also interpolate their height.
    if (Math.max(height, snapshot.height) < 900 && Math.abs(height - snapshot.height) < 400)
      this.animations.push(node.animate([{ height: `${snapshot.height}px` }, { height: `${height}px` }], options));
    this.animations.push(ghost.animate([{opacity:1},{opacity:0}], options));
    for (const child of children) this.animations.push(child.animate([{opacity:0},{opacity:1}], options));
    this.timer = setTimeout(() => this.cancel(), 200);
  }
  componentWillUnmount() { this.cancel(); }
  cancel() {
    clearTimeout(this.timer); this.ghost?.remove(); this.ghost = null;
    this.animations.forEach(animation => animation.cancel()); this.animations = [];
  }
  render() { return <div ref={this.node} className="reply-transition">{this.props.children}</div>; }
}
