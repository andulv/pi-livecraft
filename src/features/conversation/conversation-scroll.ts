const NEAR_BOTTOM_THRESHOLD = 50

/** True when the viewport is within the threshold of the conversation bottom. */
export function isNearConversationBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD
}

/** Identifies any upward movement that should stop following live output. */
export function suspendsAutoScrollAfterUpwardScroll(
  previousScrollTop: number,
  scrollTop: number,
): boolean {
  return scrollTop < previousScrollTop
}

/** Identifies a manual downward scroll that has returned near the conversation end. */
export function resumesAutoScrollAfterDownwardScroll(
  previousScrollTop: number,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop > previousScrollTop
    && isNearConversationBottom(scrollTop, scrollHeight, clientHeight)
}
