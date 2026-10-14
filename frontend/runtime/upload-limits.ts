const mebibyte = 1024 * 1024;
const multipartOverhead = 64 * 1024;

export function uploadProxyBodyLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const readLimit = (name: string, fallback: number) => {
    const value = env[name];
    if (value === undefined || value === "") return fallback;
    const size = Number(value);
    if (
      !/^\d+$/.test(value) ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 1024
    )
      throw new Error(`${name} must be an integer between 1 and 1024`);
    return size;
  };
  return (
    Math.max(
      readLimit("MAX_IMAGE_SIZE_MB", 15),
      readLimit("MAX_VIDEO_SIZE_MB", 100),
    ) *
      mebibyte +
    multipartOverhead
  );
}
