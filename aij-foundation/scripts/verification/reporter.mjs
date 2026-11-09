// Node 24 test-runner events, not application console text or PASS substrings.
export default async function* reporter(events) {
  for await (const event of events) {
    if (["test:pass", "test:fail", "test:summary", "test:diagnostic", "test:stderr", "test:stdout"].includes(event.type)) {
      yield JSON.stringify(event, (_key, value) => value instanceof Error
        ? { message: value.message, stack: value.stack, code: value.code, cause: value.cause }
        : value) + "\n";
    }
  }
}
