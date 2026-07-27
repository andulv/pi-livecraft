/** Identifies a manual downward scroll that has returned near the conversation end. */
export function resumesAutoScrollAfterDownwardScroll(previousScrollTop: number, scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollTop > previousScrollTop && scrollHeight - scrollTop - clientHeight < 50
}
