/** Owns bounded local image previews independently of retryable upload files. */
export function createUploadPreviews() {
  const urls = new Map<string, string>();

  function release(id: string) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }

  return {
    get: (id: string) => urls.get(id),
    remember(id: string, file: File) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        return;
      release(id);
      urls.set(id, URL.createObjectURL(file));
      while (urls.size > 20) release(urls.keys().next().value!);
    },
    release,
    clear() {
      for (const id of urls.keys()) release(id);
    },
  };
}
