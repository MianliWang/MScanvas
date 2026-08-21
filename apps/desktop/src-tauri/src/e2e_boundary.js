// The rendered-QA IPC boundary, appended to the invoke initialization script.
//
// This file is compiled in only under the non-default `e2e` feature. A release
// build contains none of it.
//
// It is appended rather than served, because the boundary has to be installed
// at exactly one moment: after the host has defined `__TAURI_INTERNALS__`, and
// before the application asks its first question. A script served with the
// document cannot hold that position -- the host installs its IPC globals with
// `Object.defineProperty`, which silently replaces anything a page script put
// there first. This hook runs inside that installation, so there is no race to
// lose.
//
// What it installs is an interception, not a replacement. A command with an
// entry in the table is answered from the table; a command without one reaches
// the real Rust process untouched. That is what lets one run assert both a real
// round trip and a flow whose backend would need a ProteoWizard installation,
// an mzML file, or a native save dialog no WebDriver session can dismiss.
(function () {
  var target = window;
  if (target.__mscanvasIpcCalls__ !== undefined) {
    return;
  }

  var TABLE = "__mscanvasIpcTable__";
  var CALL_LOG = "__mscanvasIpcCalls__";
  var CONSOLE_LOG = "__mscanvasConsole__";
  // Where a test leaves the answers the *next* document starts with. The
  // application asks its first questions in a mount effect, before any test can
  // reach the page, so an answer set through `execute` would always arrive
  // late. Session storage survives the reload that follows.
  var SEED = "__mscanvasIpcSeed__";

  var seeded = {};
  try {
    var stored = window.sessionStorage.getItem(SEED);
    if (stored !== null) {
      seeded = JSON.parse(stored);
    }
  } catch (error) {
    seeded = {};
  }

  target[TABLE] = seeded;
  target[CALL_LOG] = [];
  target[CONSOLE_LOG] = [];

  target.__mscanvasBoundary__ = { at: "pending", wrapped: false };

  // The interception itself: a command with an entry in the table is answered
  // from the table, and a command without one reaches the real Rust process
  // untouched. That is what lets one run assert both a real round trip and a
  // flow whose backend would need a ProteoWizard installation, an mzML file, or
  // a native save dialog no WebDriver session can dismiss.
  function intercepting(real) {
    return function (command, args, options) {
      target[CALL_LOG].push({ command: command, args: args || {} });
      var answer = target[TABLE][command];
      if (answer === undefined) {
        return real.call(this, command, args, options);
      }
      return answer.kind === "reject"
        ? Promise.reject(new Error(answer.message))
        : Promise.resolve(answer.value);
    };
  }

  var internals = target.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === "function") {
    internals.invoke = intercepting(internals.invoke.bind(internals));
    target.__mscanvasBoundary__ = { at: "already-present", wrapped: true };
  } else {
    // The host installs `invoke` with `Object.defineProperty`, non-writable and
    // non-configurable, and this script runs first. So there is exactly one
    // moment at which the function can be substituted: the definition itself.
    // Afterwards the property cannot be redefined, and an accessor left here
    // beforehand would simply be replaced without ever being told -- which is
    // what made an earlier run look like an application issuing no IPC at all.
    //
    // The patch removes itself as soon as it fires, so nothing else in the
    // document ever sees a modified `defineProperty`.
    var nativeDefine = Object.defineProperty;
    Object.defineProperty = function (object, property, descriptor) {
      if (property === "invoke" && descriptor && typeof descriptor.value === "function") {
        Object.defineProperty = nativeDefine;
        var replaced = {};
        for (var key in descriptor) {
          replaced[key] = descriptor[key];
        }
        replaced.value = intercepting(descriptor.value.bind(object));
        target.__mscanvasBoundary__ = { at: "defined-later", wrapped: true };
        return nativeDefine(object, property, replaced);
      }
      return nativeDefine(object, property, descriptor);
    };
  }

  ["error", "warn"].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      var parts = Array.prototype.slice.call(arguments).map(String);
      target[CONSOLE_LOG].push({ level: level, text: parts.join(" ") });
      original.apply(null, arguments);
    };
  });
})();
