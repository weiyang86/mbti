// Invalidate pending reads as well as visible values on hide/refresh/failure.
// This scope stores no contact data and has no persistent storage.
export function createPrivateScope(clear: () => void) {
  let active = false
  let version = 0
  const invalidate = () => { clear(); return ++version }
  return {
    enter() { active = true; invalidate() },
    leave() { active = false; invalidate() },
    begin: invalidate,
    current(ticket: number) { return active && ticket === version },
  }
}
