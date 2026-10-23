// Narrow, drift-checked extension of the pinned media adapter. Retains upstream
// authentication, provider credentials/budgets, request logging and error handling.
export function patchImageReferences(proxy, media) {
  function replace(source, before, after) {
    if (source.includes(after)) return source;
    if (source.split(before).length !== 2) throw new Error('Pinned image reference contract changed');
    return source.replace(before, () => after);
  }
  proxy = replace(proxy, "const ImageBody = z.object({", `const ImageBody = z.object({
  reference_images: z.array(z.string().max(1400000).regex(new RegExp('^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'))).min(1).max(4).optional(),`);
  proxy = replace(proxy, 'prompt: parsed.data.prompt, n: parsed.data.n, size: parsed.data.size,',
    'prompt: parsed.data.prompt, n: parsed.data.n, size: parsed.data.size, reference_images: parsed.data.reference_images,');
  media = replace(media, 'export interface ImageParams { prompt: string; n?: number; size?: string }',
    'export interface ImageParams { prompt: string; n?: number; size?: string; reference_images?: string[] }');
  media = replace(media, "        form.append('height', String(h));", `        form.append('height', String(h));
        for (const [index, image] of (p.reference_images ?? []).entries()) {
          const [header, encoded] = image.split(',');
          const mime = header.slice(5, header.indexOf(';'));
          form.append('input_image_' + index, new Blob([Buffer.from(encoded, 'base64')], { type: mime }), 'reference-' + index);
        }`);
  media = replace(media, "  const chain = resolveMediaChain(model, 'image');", `  const chain = resolveMediaChain(model, 'image').filter(row =>
    !params.reference_images?.length || (row.platform === 'cloudflare' && row.model_id === '@cf/black-forest-labs/flux-2-klein-4b'));
  if (!chain.length) throw new MediaError('No configured image editing provider is available.', 503);`);
  return { proxy, media };
}
