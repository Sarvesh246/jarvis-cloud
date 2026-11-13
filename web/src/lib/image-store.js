// Full-size images are temporary; old messages retain their thumbnail.
class ImageCache extends Map {
  constructor(limit = 20) { super(); this.limit = limit; }
  get(key) {
    if (!super.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value);
    return value;
  }
  set(key, value) {
    if (super.has(key)) {
      if (super.get(key) === value) super.delete(key);
      else this.delete(key);
    }
    super.set(key, value);
    while (this.size > this.limit) this.delete(this.keys().next().value);
    return this;
  }
  delete(key) {
    const value = super.get(key);
    const removed = super.delete(key);
    if (removed && typeof value === "string" && value.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(value);
    return removed;
  }
  clear() { for (const key of this.keys()) this.delete(key); }
}
export const fullImages = new ImageCache();
