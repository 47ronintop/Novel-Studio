// Agent Task Sandbox Host — Windows AppContainer launcher
//
// This binary is the ONLY component allowed to create task processes.
// It uses Windows AppContainer/LowBox isolation, a Job Object with
// KILL_ON_JOB_CLOSE, and CREATE_SUSPENDED / ResumeThread sequencing so
// the child is contained before any user code executes.
//
// NOTE: This source requires Windows SDK and the `windows` crate.
// Build on a Windows x64 host with:
//   cargo build --release --target x86_64-pc-windows-msvc

#[cfg(windows)]
mod windows_impl;

#[cfg(not(windows))]
fn main() {
    eprintln!("unavailable: this host only runs on Windows x64");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    windows_impl::run();
}
