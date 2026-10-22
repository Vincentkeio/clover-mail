/** Bound the raw multipart stream before the platform buffers it for parsing. */
export async function readLimitedFormData(request: Request, maxBytes: number): Promise<{ form: FormData | null; tooLarge: boolean }> {
  let tooLarge = Number(request.headers.get('content-length')) > maxBytes
  if (tooLarge) { await request.body?.cancel().catch(() => undefined); return { form: null, tooLarge } }
  if (!request.body) return { form: null, tooLarge: false }
  let received = 0
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > maxBytes) { tooLarge = true; throw new Error('upload_too_large') }
      controller.enqueue(chunk)
    },
  }))
  try {
    const form = await new Response(limited, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData()
    return { form, tooLarge: false }
  } catch { return { form: null, tooLarge } }
}
