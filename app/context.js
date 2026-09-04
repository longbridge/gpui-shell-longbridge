// The one async context this application holds.
//
// `cx` is handed to a view, not to a module: `init`, `render`, an event
// handler and a task body each get one, and a plain helper function gets
// nothing. Threading it through every layer of `http.js` would put a parameter
// on calls whose subject is a URL.
//
// So the application keeps one, and keeps the *async* flavour, which is the
// one that may be held: it names no call, resolves whichever is running when a
// member is used, and says so when none is. `init` is where it comes from,
// because that is where a view is first handed one.
//
// This is a deliberate exception with a narrow blast radius. Anything that
// draws, or that belongs to a view, takes its `cx` as an argument like
// everything else.

/** @type {import("gpui-kit").AsyncContext | null} */
let held = null;

/** @param {import("gpui-kit").AsyncContext} cx */
export function holdContext(cx) {
  held = cx;
}

/** The held context. Throws rather than returning a broken one. */
export function context() {
  if (!held) {
    throw new Error(
      "no context has been held yet; the application holds one from init(props, cx)",
    );
  }
  return held;
}
