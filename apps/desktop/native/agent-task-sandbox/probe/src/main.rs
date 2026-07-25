// Agent Task Sandbox Qualification Probe
//
// Runs a suite of observable tests to verify that the sandbox boundaries
// are enforced by the OS — not just asserted by code. Each test uses
// a harness-created nonce canary so the probe cannot pass by coincidence.
//
// Output: JSON SandboxQualificationEvidence to stdout, exit 0 on pass.
// Exit 1 + JSON error on any failure or missing capability.
//
// Build: cargo build --release --target x86_64-pc-windows-msvc

#[cfg(windows)]
mod windows_probe;

#[cfg(not(windows))]
fn main() {
    eprintln!("{}", serde_json::json!({
        "code": "PROBE_UNAVAILABLE",
        "message": "Probe only runs on Windows x64"
    }));
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    windows_probe::run();
}
