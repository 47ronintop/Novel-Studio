// Windows AppContainer sandbox host implementation.
// Parses IPC arguments, creates an AppContainer profile, launches the task
// process suspended inside the container, assigns it to a Job Object with
// KILL_ON_JOB_CLOSE before resuming it, then streams output and waits for exit.

use std::{
    collections::HashMap,
    ffi::c_void,
    ptr,
    thread,
};
use serde::Serialize;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{
            CloseHandle, SetHandleInformation, BOOL, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
        },
        Security::{
            AppLocker::AppContainerDeriveSid,
            FreeSid, GetTokenInformation, OpenProcessToken,
            TOKEN_QUERY, PSID, SECURITY_CAPABILITIES,
        },
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
                JOB_OBJECT_LIMIT_JOB_MEMORY,
                JOB_OBJECT_LIMIT_PROCESS_TIME,
                JobObjectExtendedLimitInformation,
                TerminateJobObject,
            },
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList,
                GetCurrentProcess, InitializeProcThreadAttributeList,
                ResumeThread, WaitForSingleObject,
                UpdateProcThreadAttribute, EXTENDED_STARTUPINFO_PRESENT,
                LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTUPINFOEXW,
                STARTF_USESTDHANDLES, CREATE_SUSPENDED, CREATE_NO_WINDOW,
                CREATE_UNICODE_ENVIRONMENT,
            },
        },
        Storage::FileSystem::ReadFile,
        System::Pipes::CreatePipe,
    },
};

#[derive(Debug)]
struct HostArgs {
    mode: HostMode,
    attestation_id: String,
    execution_snapshot_id: String,
    task_id: String,
    executable: String,
    workspace_projection: String,
    argv: Vec<String>,
    /// Resource quota from TaskExecutionSnapshot
    max_wall_clock_ms: u64,
    max_processes: u32,
    max_memory_bytes: u64,
    max_cpu_time_ms: u64,
    probe_context: Option<ProbeContext>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostMode {
    Task,
    Qualification,
}

#[derive(Debug)]
struct ProbeContext {
    host_digest: String,
    probe_digest: String,
    policy_revision: String,
    test_vector_revision: String,
    external_sentinel_path: String,
    network_listener_addr: String,
}

#[derive(Debug, Serialize)]
struct HostOutput {
    task_id: String,
    exit_code: Option<i32>,
    stdout_summary: String,
    stderr_summary: String,
    truncated: bool,
    duration_ms: u64,
    termination_reason: String,
}

#[derive(Debug, Serialize)]
struct HostError {
    code: String,
    message: String,
}

/// Maximum bytes collected per output stream.
const MAX_STREAM_BYTES: usize = 1_048_576;

const SE_FILE_OBJECT: u32 = 1;
const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;
const SET_ACCESS: u32 = 2;
const NO_MULTIPLE_TRUSTEE: u32 = 0;
const TRUSTEE_IS_SID: u32 = 0;
const TRUSTEE_IS_UNKNOWN: u32 = 0;
const SUB_CONTAINERS_AND_OBJECTS_INHERIT: u32 = 0x0000_0003;
const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const GENERIC_EXECUTE: u32 = 0x2000_0000;
const DELETE: u32 = 0x0001_0000;
const FILE_DELETE_CHILD: u32 = 0x0000_0040;
const READ_CONTROL: u32 = 0x0002_0000;
const WRITE_DAC: u32 = 0x0004_0000;
const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const OPEN_EXISTING: u32 = 3;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

#[repr(C)]
struct RawTrusteeW {
    multiple_trustee: *mut RawTrusteeW,
    multiple_trustee_operation: u32,
    trustee_form: u32,
    trustee_type: u32,
    name: *mut u16,
}

#[repr(C)]
struct RawExplicitAccessW {
    access_permissions: u32,
    access_mode: u32,
    inheritance: u32,
    trustee: RawTrusteeW,
}

#[repr(C)]
#[derive(Default)]
struct RawByHandleFileInformation {
    file_attributes: u32,
    creation_time_low: u32,
    creation_time_high: u32,
    last_access_time_low: u32,
    last_access_time_high: u32,
    last_write_time_low: u32,
    last_write_time_high: u32,
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[link(name = "advapi32")]
extern "system" {
    fn GetSecurityInfo(
        handle: *mut c_void,
        object_type: u32,
        security_info: u32,
        owner: *mut *mut c_void,
        group: *mut *mut c_void,
        dacl: *mut *mut c_void,
        sacl: *mut *mut c_void,
        security_descriptor: *mut *mut c_void,
    ) -> u32;
    fn SetSecurityInfo(
        handle: *mut c_void,
        object_type: u32,
        security_info: u32,
        owner: *mut c_void,
        group: *mut c_void,
        dacl: *mut c_void,
        sacl: *mut c_void,
    ) -> u32;
    fn SetEntriesInAclW(
        entry_count: u32,
        entries: *const RawExplicitAccessW,
        old_acl: *mut c_void,
        new_acl: *mut *mut c_void,
    ) -> u32;
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *mut c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: *mut c_void,
    ) -> *mut c_void;
    fn GetFileInformationByHandle(
        handle: *mut c_void,
        information: *mut RawByHandleFileInformation,
    ) -> i32;
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

struct ProjectionAclGuard {
    handle: *mut c_void,
    original_dacl: *mut c_void,
    security_descriptor: *mut c_void,
    granted_dacl: *mut c_void,
    restored: bool,
}

impl ProjectionAclGuard {
    unsafe fn restore(&mut self) -> Result<(), HostError> {
        if self.restored {
            return Ok(());
        }
        let result = SetSecurityInfo(
            self.handle,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            self.original_dacl,
            ptr::null_mut(),
        );
        if result != 0 {
            return Err(host_error(
                "PROJECTION_ACL_RESTORE_FAILED",
                "Failed to restore the workspace projection ACL.",
            ));
        }
        self.restored = true;
        Ok(())
    }
}

impl Drop for ProjectionAclGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = self.restore();
            if !self.granted_dacl.is_null() {
                LocalFree(self.granted_dacl);
            }
            if !self.security_descriptor.is_null() {
                LocalFree(self.security_descriptor);
            }
            if !self.handle.is_null() && self.handle as isize != -1 {
                CloseHandle(HANDLE(self.handle));
            }
        }
    }
}

/// Grants the per-execution AppContainer SID access to exactly one opened
/// projection directory. The original DACL is restored before the handle is
/// released, so an interrupted task cannot leave a reusable SID grant behind.
unsafe fn grant_projection_access(
    projection: &str,
    app_container_sid: PSID,
) -> Result<ProjectionAclGuard, HostError> {
    if projection.is_empty() || app_container_sid.is_null() {
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "The workspace projection or AppContainer SID is invalid.",
        ));
    }
    let projection_w: Vec<u16> = projection.encode_utf16().chain(std::iter::once(0)).collect();
    let handle = CreateFileW(
        projection_w.as_ptr(),
        READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        ptr::null_mut(),
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        ptr::null_mut(),
    );
    if handle.is_null() || handle as isize == -1 {
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "Failed to open the workspace projection without following a reparse point.",
        ));
    }

    let mut information = RawByHandleFileInformation::default();
    if GetFileInformationByHandle(handle, &mut information) == 0 {
        CloseHandle(HANDLE(handle));
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "Failed to inspect the workspace projection handle.",
        ));
    }
    if information.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || information.file_attributes & FILE_ATTRIBUTE_DIRECTORY == 0
    {
        CloseHandle(HANDLE(handle));
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "The workspace projection must be a regular directory.",
        ));
    }

    let mut original_dacl: *mut c_void = ptr::null_mut();
    let mut security_descriptor: *mut c_void = ptr::null_mut();
    let security_result = GetSecurityInfo(
        handle,
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        ptr::null_mut(),
        ptr::null_mut(),
        &mut original_dacl,
        ptr::null_mut(),
        &mut security_descriptor,
    );
    if security_result != 0 {
        CloseHandle(HANDLE(handle));
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "Failed to read the workspace projection DACL.",
        ));
    }

    let access = RawExplicitAccessW {
        access_permissions: GENERIC_READ
            | GENERIC_WRITE
            | GENERIC_EXECUTE
            | DELETE
            | FILE_DELETE_CHILD,
        access_mode: SET_ACCESS,
        inheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        trustee: RawTrusteeW {
            multiple_trustee: ptr::null_mut(),
            multiple_trustee_operation: NO_MULTIPLE_TRUSTEE,
            trustee_form: TRUSTEE_IS_SID,
            trustee_type: TRUSTEE_IS_UNKNOWN,
            name: app_container_sid as *mut u16,
        },
    };
    let mut granted_dacl: *mut c_void = ptr::null_mut();
    let acl_result = SetEntriesInAclW(1, &access, original_dacl, &mut granted_dacl);
    if acl_result != 0 {
        LocalFree(security_descriptor);
        CloseHandle(HANDLE(handle));
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "Failed to construct the AppContainer projection DACL.",
        ));
    }
    let set_result = SetSecurityInfo(
        handle,
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        ptr::null_mut(),
        ptr::null_mut(),
        granted_dacl,
        ptr::null_mut(),
    );
    if set_result != 0 {
        LocalFree(granted_dacl);
        LocalFree(security_descriptor);
        CloseHandle(HANDLE(handle));
        return Err(host_error(
            "PROJECTION_ACL_FAILED",
            "Failed to apply the AppContainer projection DACL.",
        ));
    }

    Ok(ProjectionAclGuard {
        handle,
        original_dacl,
        security_descriptor,
        granted_dacl,
        restored: false,
    })
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    match parse_args(&args) {
        Ok(host_args) => {
            let qualification = host_args.mode == HostMode::Qualification;
            match launch_task(host_args) {
                Ok(output) => {
                    if qualification {
                        // The qualification service consumes the probe's JSON directly.
                        print!("{}", output.stdout_summary);
                        std::process::exit(if output.exit_code == Some(0) { 0 } else { 1 });
                    } else {
                        println!("{}", serde_json::to_string(&output).unwrap_or_default());
                        std::process::exit(0);
                    }
                }
                Err(e) => {
                    eprintln!("{}", serde_json::to_string(&e).unwrap_or_default());
                    std::process::exit(1);
                }
            }
        }
        Err(msg) => {
            let e = HostError { code: "INVALID_ARGS".to_string(), message: msg };
            eprintln!("{}", serde_json::to_string(&e).unwrap_or_default());
            std::process::exit(1);
        }
    }
}

fn parse_args(args: &[String]) -> Result<HostArgs, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    let mut extra_argv: Vec<String> = Vec::new();
    let mut i = 1usize;
    let mut after_double_dash = false;
    while i < args.len() {
        let arg = &args[i];
        if after_double_dash {
            extra_argv.push(arg.clone());
            i += 1;
            continue;
        }
        if arg == "--" {
            after_double_dash = true;
            i += 1;
            continue;
        }
        if let Some(key) = arg.strip_prefix("--") {
            let value = args.get(i + 1).cloned().unwrap_or_default();
            map.insert(key.to_string(), value);
            i += 2;
        } else {
            i += 1;
        }
    }

    let mode = match map.get("mode").map(String::as_str).unwrap_or("task") {
        "task" => HostMode::Task,
        "qualification" => HostMode::Qualification,
        value => return Err(format!("unsupported --mode '{value}'")),
    };
    let probe_context = if mode == HostMode::Qualification {
        Some(ProbeContext {
            host_digest: required_arg(&map, "probe-host-digest")?,
            probe_digest: required_arg(&map, "probe-digest")?,
            policy_revision: required_arg(&map, "probe-policy-revision")?,
            test_vector_revision: required_arg(&map, "probe-test-vector-revision")?,
            external_sentinel_path: required_arg(&map, "probe-external-sentinel-path")?,
            network_listener_addr: required_arg(&map, "probe-network-listener-addr")?,
        })
    } else {
        None
    };

    Ok(HostArgs {
        mode,
        attestation_id: required_arg(&map, "attestation-id")?,
        execution_snapshot_id: required_arg(&map, "execution-snapshot-id")?,
        task_id: required_arg(&map, "task-id")?,
        executable: if mode == HostMode::Qualification {
            required_arg(&map, "qualification-probe")?
        } else {
            required_arg(&map, "executable")?
        },
        workspace_projection: required_arg(&map, "workspace-projection")?,
        argv: extra_argv,
        max_wall_clock_ms: map.get("max-wall-clock-ms")
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_000),
        max_processes: map.get("max-processes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(32),
        max_memory_bytes: map.get("max-memory-bytes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(512 * 1024 * 1024),
        max_cpu_time_ms: map.get("max-cpu-time-ms")
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_000),
        probe_context,
    })
}

fn required_arg(map: &HashMap<String, String>, key: &str) -> Result<String, String> {
    map.get(key)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| format!("missing --{key}"))
}

fn launch_task(args: HostArgs) -> Result<HostOutput, HostError> {
    let start = std::time::Instant::now();

    // Refuse if running elevated (integrity level check)
    if is_elevated()? {
        return Err(host_error("ELEVATED_PROCESS",
            "Host refuses to launch tasks from an elevated process."));
    }

    // Bind the AppContainer identity to a single immutable execution snapshot.
    // Reusing a task-level identity would allow permissions or state to bleed
    // between independent executions.
    let container_name = sanitize_container_name(&format!(
        "NovelStudioTask_{}_{}",
        args.task_id, args.execution_snapshot_id
    ));
    let container_name_w: Vec<u16> = container_name.encode_utf16().chain(std::iter::once(0)).collect();

    // Derive or create AppContainer SID
    let app_container_sid = unsafe {
        derive_or_create_app_container_sid(&container_name_w)?
    };

    let mut projection_acl = match unsafe {
        grant_projection_access(&args.workspace_projection, app_container_sid)
    } {
        Ok(guard) => guard,
        Err(error) => {
            unsafe { FreeSid(app_container_sid) };
            return Err(error);
        }
    };

    // Create Job Object with kill-on-close and resource limits
    let job_handle = match unsafe { create_job_object_with_limits(&args) } {
        Ok(handle) => handle,
        Err(error) => {
            unsafe { FreeSid(app_container_sid) };
            return Err(error);
        }
    };

    // Build command line: executable + argv
    let command_line = build_command_line(&args.executable, &args.argv);
    let mut command_line_w: Vec<u16> = command_line.encode_utf16().chain(std::iter::once(0)).collect();
    let environment = build_sandbox_environment(args.probe_context.as_ref());

    // Create the process suspended in the AppContainer. The security attribute is
    // supplied to CreateProcessW itself; merely deriving a SID is not isolation.
    let (proc_info, stdout_read, stderr_read) = match unsafe {
        create_sandboxed_process(
            &mut command_line_w,
            app_container_sid,
            &args.workspace_projection,
            &environment,
        )
    } {
        Ok(process) => process,
        Err(message) => {
            unsafe {
                CloseHandle(job_handle);
                FreeSid(app_container_sid);
            }
            return Err(host_error("PROCESS_CREATE_FAILED", &message));
        }
    };

    // Assign to Job Object BEFORE resuming
    unsafe {
        if AssignProcessToJobObject(job_handle, proc_info.hProcess).is_err() {
            terminate_and_close(proc_info, job_handle, app_container_sid);
            return Err(host_error("JOB_ASSIGN_FAILED",
                "Failed to assign task process to Job Object before resume."));
        }
        // Now safe to resume — user code cannot run before Job containment
        if ResumeThread(proc_info.hThread) == u32::MAX {
            terminate_and_close(proc_info, job_handle, app_container_sid);
            return Err(host_error("PROCESS_RESUME_FAILED",
                "Failed to resume task process after Job assignment."));
        }
        CloseHandle(proc_info.hThread);
    }

    // Drain both pipes concurrently. Draining only one pipe can deadlock a task
    // that fills the other stream, which in turn makes the wall-clock limit moot.
    let stdout_reader = thread::spawn(move || read_pipe_bounded(stdout_read, MAX_STREAM_BYTES));
    let stderr_reader = thread::spawn(move || read_pipe_bounded(stderr_read, MAX_STREAM_BYTES));

    // Wait for process with wall-clock timeout. On timeout terminate the Job,
    // rather than only the root PID, so descendants cannot escape teardown.
    let wait_ms = args.max_wall_clock_ms.min(3_600_000) as u32;
    let exit_code = unsafe {
        wait_for_process(proc_info.hProcess, wait_ms)
    };

    let duration_ms = start.elapsed().as_millis() as u64;
    let termination_reason = if exit_code.is_none() { "timeout" } else { "completed" }.to_string();

    // Terminate on timeout
    if exit_code.is_none() {
        unsafe {
            TerminateJobObject(job_handle, 1);
            let _ = WaitForSingleObject(proc_info.hProcess, 5_000);
        }
    }

    let stdout_result = stdout_reader.join().unwrap_or_else(|_| (Vec::new(), true));
    let stderr_result = stderr_reader.join().unwrap_or_else(|_| (Vec::new(), true));

    unsafe {
        CloseHandle(proc_info.hProcess);
        CloseHandle(job_handle);
        if !app_container_sid.is_null() {
            FreeSid(app_container_sid);
        }
    }

    unsafe { projection_acl.restore()? };

    let truncated = stdout_result.1 || stderr_result.1;

    Ok(HostOutput {
        task_id: args.task_id,
        exit_code,
        stdout_summary: String::from_utf8_lossy(&stdout_result.0[..stdout_result.0.len().min(4096)]).into_owned(),
        stderr_summary: String::from_utf8_lossy(&stderr_result.0[..stderr_result.0.len().min(4096)]).into_owned(),
        truncated,
        duration_ms,
        termination_reason,
    })
}

/// Returns whether the current process token is elevated. Query failures are
/// fatal because treating an unknown token as non-elevated would fail open.
fn is_elevated() -> Result<bool, HostError> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|_| host_error("TOKEN_QUERY_FAILED", "Failed to open the host process token."))?;
        let mut elevation_type: u32 = 0;
        let mut ret_len: u32 = 0;
        let result = GetTokenInformation(
            token,
            windows::Win32::Security::TokenElevationType,
            Some(std::ptr::addr_of_mut!(elevation_type) as *mut _),
            std::mem::size_of::<u32>() as u32,
            &mut ret_len,
        );
        CloseHandle(token);
        result.map_err(|_| {
            host_error(
                "TOKEN_ELEVATION_QUERY_FAILED",
                "Failed to determine whether the host process token is elevated.",
            )
        })?;
        // TokenElevationTypeFull = 2.
        Ok(elevation_type == 2)
    }
}

fn sanitize_container_name(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .take(64)
        .collect()
}

/// Derive a per-run AppContainer SID on Windows 8+.
unsafe fn derive_or_create_app_container_sid(
    container_name_w: &[u16],
) -> Result<PSID, HostError> {
    let mut sid: PSID = PSID::default();
    let result = AppContainerDeriveSid(
        PCWSTR::from_raw(container_name_w.as_ptr()),
        &mut sid,
    );
    if result.is_err() {
        return Err(host_error("APPCONTAINER_SID_FAILED",
            "Failed to derive AppContainer SID."));
    }
    Ok(sid)
}

/// Create a Job Object with appropriate resource limits and KILL_ON_JOB_CLOSE.
unsafe fn create_job_object_with_limits(
    args: &HostArgs,
) -> Result<HANDLE, HostError> {
    let job = CreateJobObjectW(None, None)
        .map_err(|_| host_error("JOB_CREATE_FAILED", "CreateJobObjectW failed."))?;

    let mut ext_limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    ext_limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_JOB_MEMORY;

    ext_limits.BasicLimitInformation.ActiveProcessLimit = args.max_processes;
    ext_limits.JobMemoryLimit = args.max_memory_bytes as usize;

    // Per-process user-mode CPU time limit (100ns intervals)
    if args.max_cpu_time_ms > 0 {
        ext_limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_TIME;
        ext_limits.BasicLimitInformation.PerProcessUserTimeLimit =
            (args.max_cpu_time_ms.min(i64::MAX as u64 / 10_000) as i64) * 10_000;
    }

    let ok = SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        std::ptr::addr_of!(ext_limits) as *const _,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    );
    if ok.is_err() {
        CloseHandle(job);
        return Err(host_error("JOB_LIMITS_FAILED",
            "SetInformationJobObject for extended limits failed."));
    }

    Ok(job)
}

unsafe fn terminate_and_close(proc_info: PROCESS_INFORMATION, job: HANDLE, sid: PSID) {
    let _ = TerminateJobObject(job, 1);
    let _ = WaitForSingleObject(proc_info.hProcess, 5_000);
    CloseHandle(proc_info.hProcess);
    CloseHandle(proc_info.hThread);
    CloseHandle(job);
    if !sid.is_null() {
        FreeSid(sid);
    }
}

/// Build a properly quoted command line string from executable + argv.
fn build_command_line(executable: &str, argv: &[String]) -> String {
    let mut cmd = quote_arg(executable);
    for arg in argv {
        cmd.push(' ');
        cmd.push_str(&quote_arg(arg));
    }
    cmd
}

fn quote_arg(s: &str) -> String {
    if !s.is_empty() && !s.chars().any(|c| c == ' ' || c == '"' || c == '\t') {
        s.to_string()
    } else {
        // CommandLineToArgvW quoting: only backslashes immediately before a
        // quote (or the closing quote) are doubled. Doubling every separator
        // corrupts executable paths such as C:\\Program Files\\tool.exe.
        let mut quoted = String::from("\"");
        let mut slash_count = 0usize;
        for character in s.chars() {
            match character {
                '\\' => slash_count += 1,
                '"' => {
                    quoted.extend(std::iter::repeat('\\').take(slash_count * 2 + 1));
                    quoted.push('"');
                    slash_count = 0;
                }
                _ => {
                    quoted.extend(std::iter::repeat('\\').take(slash_count));
                    quoted.push(character);
                    slash_count = 0;
                }
            }
        }
        quoted.extend(std::iter::repeat('\\').take(slash_count * 2));
        quoted.push('"');
        quoted
    }
}

/// The native host does not inherit the desktop's environment. Keep only the
/// variables Windows needs to create a process, plus the qualification binding
/// passed over the verified host command line.
fn build_sandbox_environment(probe: Option<&ProbeContext>) -> Vec<u16> {
    let mut values = vec!["AGENT_TASK_SANDBOX_PROTOCOL=1.0".to_string()];
    for name in ["SystemRoot", "WINDIR"] {
        if let Ok(value) = std::env::var(name) {
            if !value.is_empty() {
                values.push(format!("{name}={value}"));
            }
        }
    }
    if let Some(context) = probe {
        values.push(format!("PROBE_HOST_DIGEST={}", context.host_digest));
        values.push(format!("PROBE_PROBE_DIGEST={}", context.probe_digest));
        values.push("PROBE_PROTOCOL_VERSION=1.0".to_string());
        values.push(format!("PROBE_POLICY_REVISION={}", context.policy_revision));
        values.push(format!(
            "PROBE_TEST_VECTOR_REVISION={}",
            context.test_vector_revision
        ));
        values.push(format!(
            "PROBE_EXTERNAL_SENTINEL_PATH={}",
            context.external_sentinel_path
        ));
        values.push(format!(
            "PROBE_NETWORK_LISTENER_ADDR={}",
            context.network_listener_addr
        ));
    }
    values.sort_unstable();
    let mut block = values.join("\0").encode_utf16().collect::<Vec<_>>();
    block.extend([0, 0]);
    block
}

/// Create a process suspended in an AppContainer with pipe-redirected stdio.
///
/// AppContainer SID assignment is an extended startup attribute. Creating a
/// normal suspended process and remembering a SID in the host would leave the
/// child unsandboxed, so this function fails closed if the attribute list cannot
/// be allocated or populated.
unsafe fn create_sandboxed_process(
    command_line_w: &mut [u16],
    app_container_sid: PSID,
    workspace_projection: &str,
    environment: &[u16],
) -> Result<(PROCESS_INFORMATION, HANDLE, HANDLE), String> {
    use windows::Win32::Foundation::SECURITY_ATTRIBUTES;

    let mut sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: BOOL::from(true),
    };

    let mut stdout_read = HANDLE::default();
    let mut stdout_write = HANDLE::default();
    let mut stderr_read = HANDLE::default();
    let mut stderr_write = HANDLE::default();

    if CreatePipe(&mut stdout_read, &mut stdout_write, Some(&sa), 0).is_err() {
        return Err("CreatePipe(stdout) failed.".to_string());
    }
    if CreatePipe(&mut stderr_read, &mut stderr_write, Some(&sa), 0).is_err() {
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        return Err("CreatePipe(stderr) failed.".to_string());
    }
    if SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, HANDLE_FLAGS(0)).is_err()
        || SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, HANDLE_FLAGS(0)).is_err()
    {
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("SetHandleInformation(pipe read end) failed.".to_string());
    }

    let mut attribute_size = 0usize;
    let _ = InitializeProcThreadAttributeList(None, 2, 0, &mut attribute_size);
    if attribute_size == 0 {
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("InitializeProcThreadAttributeList did not provide a buffer size.".to_string());
    }
    let attribute_word_count =
        (attribute_size + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>();
    let mut attribute_storage = vec![0usize; attribute_word_count];
    let attribute_list = attribute_storage.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    if InitializeProcThreadAttributeList(attribute_list, 2, 0, &mut attribute_size).is_err() {
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("InitializeProcThreadAttributeList failed.".to_string());
    }

    let mut security_capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: app_container_sid,
        Capabilities: std::ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };

    if UpdateProcThreadAttribute(
        attribute_list,
        0,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
        Some(std::ptr::addr_of_mut!(security_capabilities) as *const c_void),
        std::mem::size_of::<SECURITY_CAPABILITIES>(),
        None,
        None,
    ).is_err() {
        DeleteProcThreadAttributeList(attribute_list);
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("UpdateProcThreadAttribute(SECURITY_CAPABILITIES) failed.".to_string());
    }

    // Even though stdio needs inheritance, do not leak arbitrary handles the
    // desktop process may have passed to the native host.
    let inherited_handles = [stdout_write, stderr_write];
    if UpdateProcThreadAttribute(
        attribute_list,
        0,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
        Some(inherited_handles.as_ptr() as *const c_void),
        std::mem::size_of_val(&inherited_handles),
        None,
        None,
    ).is_err() {
        DeleteProcThreadAttributeList(attribute_list);
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("UpdateProcThreadAttribute(HANDLE_LIST) failed.".to_string());
    }

    let mut si = STARTUPINFOEXW::default();
    si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    si.StartupInfo.hStdOutput = stdout_write;
    si.StartupInfo.hStdError = stderr_write;
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.lpAttributeList = attribute_list;
    let mut pi = PROCESS_INFORMATION::default();
    let flags = CREATE_SUSPENDED
        | CREATE_NO_WINDOW
        | CREATE_UNICODE_ENVIRONMENT
        | EXTENDED_STARTUPINFO_PRESENT;

    // The host receives an explicit allowlist environment from the desktop
    // adapter. Never set this to the desktop process environment implicitly.
    let cwd_w: Vec<u16> = workspace_projection
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    if workspace_projection.is_empty() {
        DeleteProcThreadAttributeList(attribute_list);
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        CloseHandle(stderr_read);
        CloseHandle(stderr_write);
        return Err("workspace projection is required.".to_string());
    }
    let env = Some(environment.as_ptr() as *const c_void);
    let cwd = PCWSTR::from_raw(cwd_w.as_ptr());

    let result = CreateProcessW(
        None,
        Some(windows::core::PWSTR::from_raw(command_line_w.as_mut_ptr())),
        None,
        None,
        BOOL::from(true), // inherit handles (for pipes)
        flags,
        env,
        cwd,
        &si.StartupInfo,
        &mut pi,
    );

    DeleteProcThreadAttributeList(attribute_list);
    // Close write ends in host so readers observe EOF after the task exits.
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);

    if result.is_err() {
        CloseHandle(stdout_read);
        CloseHandle(stderr_read);
        return Err(format!("CreateProcessW failed: {:?}", result.err()));
    }

    Ok((pi, stdout_read, stderr_read))
}

/// Drain a pipe to EOF while retaining only the bounded prefix. Continuing to
/// drain after the cap prevents a task from blocking on a full pipe buffer.
fn read_pipe_bounded(handle: HANDLE, max_bytes: usize) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut truncated = false;
    let mut chunk = [0u8; 4096];
    loop {
        let mut bytes_read = 0u32;
        let result = unsafe { ReadFile(handle, Some(&mut chunk), Some(&mut bytes_read), None) };
        if result.is_err() || bytes_read == 0 {
            break;
        }
        let remaining = max_bytes.saturating_sub(buf.len());
        let captured = remaining.min(bytes_read as usize);
        buf.extend_from_slice(&chunk[..captured]);
        truncated |= captured < bytes_read as usize;
    }
    unsafe { CloseHandle(handle); }
    (buf, truncated)
}

/// Wait for process exit with timeout. Returns exit code or None on timeout.
unsafe fn wait_for_process(proc: HANDLE, timeout_ms: u32) -> Option<i32> {
    let result = WaitForSingleObject(proc, timeout_ms);
    if result.0 == 0 {
        // WAIT_OBJECT_0
        let mut exit_code: u32 = 0;
        windows::Win32::System::Threading::GetExitCodeProcess(proc, &mut exit_code);
        Some(exit_code as i32)
    } else {
        None
    }
}

fn host_error(code: &str, message: &str) -> HostError {
    HostError {
        code: code.to_string(),
        message: message.to_string(),
    }
}
