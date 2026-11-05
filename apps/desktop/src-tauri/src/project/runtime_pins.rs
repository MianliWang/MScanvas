//! What ties this build to one analysis runtime, in one place.
//!
//! A later runtime changes these values and the recipe's and the worker's code
//! around them stays as it is. The recipe's own words -- the engine's package
//! and algorithm, the fixed profile, the recipe version and the adapter -- stay
//! in [`super::recipe`], which re-exports the three pins it names plans by.

/// SHA-256 of the canonical runtime manifest this build pins, as
/// `scripts/provision_targeted_ms1_runtime.py` writes it.
pub const RUNTIME_MANIFEST_SHA256: &str =
    "6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295";

/// The engine's version, for the interface and the record. Its identity is the
/// runtime manifest; this is a name.
pub const ENGINE_VERSION: &str = "3.5.0";
/// The revision OpenMS reports about itself in this runtime. It is not the
/// `release/3.5.0` tag commit; the two are recorded as different in M9.0.
pub const ENGINE_REVISION: &str = "c1370fb";

/// The modules whose files must be among those the worker reports loaded.
pub const REQUIRED_MODULES: [&str; 4] = [
    "python313.dll",
    "site-packages/pyopenms/openms.dll",
    "site-packages/pyopenms/openswathalgo.dll",
    "site-packages/pyopenms/qt6core.dll",
];

/// The development runtime's folder under the repository's `.tmp`.
pub const DEVELOPMENT_RUNTIME_ROOT: &str = "m91-runtime";
/// The interpreter's folder in [`DEVELOPMENT_RUNTIME_ROOT`], beside the manifest.
pub const DEVELOPMENT_RUNTIME_DIR: &str = "cpython-3.13.15-embed";
