const mebibyte = 1024 * 1024;
const multipartOverhead = 64 * 1024;

export function uploadProxyBodyLimit(): number {
  // Go enforces the current saved limits. This fixed ceiling allows the host to
  // increase them up to 1024 MiB without restarting the frontend.
  return 1024 * mebibyte + multipartOverhead;
}
