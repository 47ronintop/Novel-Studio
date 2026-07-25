// Windows handle-relative no-follow file lifecycle host.
//
// The TypeScript adapter communicates with this executable only through one
// bounded JSON request on stdin and one JSON response on stdout. Non-Windows
// builds intentionally do not provide a fallback implementation.

#[cfg(windows)]
mod windows_impl;

#[cfg(not(windows))]
fn main() {
    eprintln!("unavailable: native file operations require Windows x64");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    windows_impl::run();
}
