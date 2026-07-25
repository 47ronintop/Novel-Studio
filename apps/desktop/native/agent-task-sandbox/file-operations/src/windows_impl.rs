// Handle-relative Windows implementation for agent file lifecycle mutations.
//
// Every path below the project root is opened one segment at a time relative to
// an already-open directory handle. All retained handles deny FILE_SHARE_WRITE
// and FILE_SHARE_DELETE while the mutation runs, so another process cannot
// replace a junction, file, or parent directory between validation and use.
// Native NtCreateFile/NtSetInformationFile are used because Win32 pathname
// helpers cannot express a root-directory handle for create/rename/delete.

use serde::{Deserialize, Serialize};
use std::{
    ffi::c_void,
    io::{self, Read},
    mem,
    ptr,
    slice,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

type Handle = *mut c_void;
type NtStatus = i32;

const PROTOCOL_VERSION: &str = "1.1";
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;
const MAX_PATH_CHARS: usize = 1024;

const OBJ_CASE_INSENSITIVE: u32 = 0x0000_0040;
// Windows 10+ fails this request instead of transparently traversing a reparse
// point. Unsupported systems are unavailable rather than downgraded.
const OBJ_DONT_REPARSE: u32 = 0x0000_1000;

const FILE_SHARE_READ: u32 = 0x0000_0001;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

const FILE_READ_DATA: u32 = 0x0000_0001;
const FILE_WRITE_DATA: u32 = 0x0000_0002;
const FILE_ADD_FILE: u32 = 0x0000_0002;
const FILE_ADD_SUBDIRECTORY: u32 = 0x0000_0004;
const FILE_EXECUTE: u32 = 0x0000_0020;
const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
const DELETE: u32 = 0x0001_0000;
const SYNCHRONIZE: u32 = 0x0010_0000;

const FILE_OPEN: u32 = 0x0000_0001;
const FILE_CREATE: u32 = 0x0000_0002;
const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0000_0020;
const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
const FILE_BEGIN: u32 = 0;

const FILE_RENAME_INFORMATION: u32 = 10;
const FILE_DISPOSITION_INFORMATION: u32 = 13;
const FILE_RENAME_INFORMATION_EX: u32 = 65;
const FILE_RENAME_FLAG_REPLACE_IF_EXISTS: u32 = 0x0000_0001;
const FILE_RENAME_FLAG_POSIX_SEMANTICS: u32 = 0x0000_0002;

const STATUS_OBJECT_NAME_NOT_FOUND: NtStatus = 0xC000_0034u32 as i32;
const STATUS_OBJECT_PATH_NOT_FOUND: NtStatus = 0xC000_003Au32 as i32;
const STATUS_NO_SUCH_FILE: NtStatus = 0xC000_000Fu32 as i32;
const STATUS_OBJECT_NAME_COLLISION: NtStatus = 0xC000_0035u32 as i32;
const STATUS_INVALID_INFO_CLASS: NtStatus = 0xC000_0003u32 as i32;
const STATUS_NOT_SUPPORTED: NtStatus = 0xC000_00BBu32 as i32;
const STATUS_INVALID_PARAMETER: NtStatus = 0xC000_000Du32 as i32;
const STATUS_STOPPED_ON_SYMLINK: NtStatus = 0x8000_002Du32 as i32;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: Handle,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut c_void,
    security_quality_of_service: *mut c_void,
}

#[repr(C)]
struct IoStatusBlock {
    status: NtStatus,
    information: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct FileTime {
    low_date_time: u32,
    high_date_time: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct ByHandleFileInformation {
    file_attributes: u32,
    creation_time: FileTime,
    last_access_time: FileTime,
    last_write_time: FileTime,
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[repr(C)]
struct FileDispositionInformation {
    delete_file: u8,
}

#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        file_handle: *mut Handle,
        desired_access: u32,
        object_attributes: *mut ObjectAttributes,
        io_status_block: *mut IoStatusBlock,
        allocation_size: *mut i64,
        file_attributes: u32,
        share_access: u32,
        create_disposition: u32,
        create_options: u32,
        ea_buffer: *mut c_void,
        ea_length: u32,
    ) -> NtStatus;
    fn NtSetInformationFile(
        file_handle: Handle,
        io_status_block: *mut IoStatusBlock,
        file_information: *mut c_void,
        length: u32,
        file_information_class: u32,
    ) -> NtStatus;
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
        template_file: Handle,
    ) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetFileInformationByHandle(handle: Handle, information: *mut ByHandleFileInformation) -> i32;
    fn ReadFile(
        handle: Handle,
        buffer: *mut c_void,
        bytes_to_read: u32,
        bytes_read: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn WriteFile(
        handle: Handle,
        buffer: *const c_void,
        bytes_to_write: u32,
        bytes_written: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn SetFilePointerEx(handle: Handle, distance: i64, new_position: *mut i64, move_method: u32) -> i32;
    fn SetEndOfFile(handle: Handle) -> i32;
    fn FlushFileBuffers(handle: Handle) -> i32;
}

#[derive(Debug)]
struct NativeError {
    code: &'static str,
}

impl NativeError {
    const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

type NativeResult<T> = Result<T, NativeError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpcRequest {
    schema_version: String,
    root: String,
    root_identity: RootIdentity,
    operation: Operation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RootIdentity {
    device: String,
    inode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcResponse {
    schema_version: &'static str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum Operation {
    ReplaceFile {
        phase: String,
        relative_path: String,
        content: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
    CreateFile {
        relative_path: String,
        content: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
    MoveFile {
        source_path: String,
        target_path: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
    DeleteFile {
        relative_path: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
    CreateDirectory {
        relative_path: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
    RemoveDirectory {
        relative_path: String,
        before: Vec<PathSnapshot>,
        after: Vec<PathSnapshot>,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum PathSnapshot {
    Missing { relative_path: String },
    Directory { relative_path: String },
    File {
        relative_path: String,
        content: String,
        checksum: String,
    },
}

struct OwnedHandle(Handle);

impl OwnedHandle {
    fn raw(&self) -> Handle {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !is_invalid_handle(self.0) {
            unsafe {
                CloseHandle(self.0);
            }
            self.0 = ptr::null_mut();
        }
    }
}

struct DirectoryChain {
    handles: Vec<OwnedHandle>,
}

impl DirectoryChain {
    fn current(&self) -> Handle {
        self.handles
            .last()
            .expect("directory chain must contain the project root")
            .raw()
    }
}

struct RelativeParent {
    // Root handles are retained by the caller's DirectoryChain. This vector
    // only owns path segments below that root.
    _branch: Vec<OwnedHandle>,
    parent: Handle,
    leaf: String,
}

struct ParentPair {
    // Owns the project-root and all shared ancestor handles for both paths.
    // Branches only begin after the paths diverge, so no extra open conflicts
    // with an exclusive share lock held by a sibling branch.
    _common_branch: Vec<OwnedHandle>,
    common_parent: Handle,
    _source_branch: Vec<OwnedHandle>,
    _target_branch: Vec<OwnedHandle>,
    source_leaf: String,
    target_leaf: String,
}

impl ParentPair {
    fn source_parent(&self) -> Handle {
        self._source_branch
            .last()
            .map(OwnedHandle::raw)
            .unwrap_or(self.common_parent)
    }

    fn target_parent(&self) -> Handle {
        self._target_branch
            .last()
            .map(OwnedHandle::raw)
            .unwrap_or(self.common_parent)
    }
}

pub fn run() {
    let response = match read_request().and_then(execute) {
        Ok(()) => IpcResponse {
            schema_version: PROTOCOL_VERSION,
            ok: true,
            code: None,
        },
        Err(error) => IpcResponse {
            schema_version: PROTOCOL_VERSION,
            ok: false,
            code: Some(error.code),
        },
    };
    println!("{}", serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"schemaVersion\":\"1.1\",\"ok\":false,\"code\":\"HOST_PROTOCOL_FAILURE\"}".to_string()
    }));
    if response.ok {
        std::process::exit(0);
    }
    std::process::exit(1);
}

fn read_request() -> NativeResult<IpcRequest> {
    let mut bytes = Vec::new();
    io::stdin()
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| NativeError::new("HOST_INPUT_INVALID"))?;
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err(NativeError::new("REQUEST_TOO_LARGE"));
    }
    let request: IpcRequest = serde_json::from_slice(&bytes)
        .map_err(|_| NativeError::new("HOST_INPUT_INVALID"))?;
    if request.schema_version != PROTOCOL_VERSION {
        return Err(NativeError::new("HOST_PROTOCOL_INVALID"));
    }
    Ok(request)
}

fn execute(request: IpcRequest) -> NativeResult<()> {
    let mut root = open_project_root(&request.root)?;
    verify_root_identity(&root, &request.root_identity)?;
    match request.operation {
        Operation::ReplaceFile {
            phase,
            relative_path,
            content,
            before,
            after,
        } => {
            if !matches!(phase.as_str(), "apply" | "compensate" | "undo") {
                return Err(NativeError::new("PATH_REJECTED"));
            }
            let expected_before = expect_file(&before, &relative_path)?;
            let expected_after = expect_file(&after, &relative_path)?;
            if expected_after != content || content.as_bytes().len() > MAX_TEXT_BYTES {
                return Err(NativeError::new("PRECONDITION_FAILED"));
            }
            replace_file(&mut root, &relative_path, expected_before, &content)
        }
        Operation::CreateFile {
            relative_path,
            content,
            before,
            after,
        } => {
            expect_missing(&before, &relative_path)?;
            let expected_after = expect_file(&after, &relative_path)?;
            if expected_after != content || content.as_bytes().len() > MAX_TEXT_BYTES {
                return Err(NativeError::new("PRECONDITION_FAILED"));
            }
            create_file(&mut root, &relative_path, &content)
        }
        Operation::MoveFile {
            source_path,
            target_path,
            before,
            after,
        } => {
            let source_content = expect_move_before(&before, &source_path, &target_path)?;
            expect_move_after(&after, &source_path, &target_path, source_content)?;
            move_file(&mut root, &source_path, &target_path, source_content)
        }
        Operation::DeleteFile {
            relative_path,
            before,
            after,
        } => {
            let expected_before = expect_file(&before, &relative_path)?;
            expect_missing(&after, &relative_path)?;
            delete_file(&mut root, &relative_path, expected_before)
        }
        Operation::CreateDirectory {
            relative_path,
            before,
            after,
        } => {
            expect_missing(&before, &relative_path)?;
            expect_directory(&after, &relative_path)?;
            create_directory(&mut root, &relative_path)
        }
        Operation::RemoveDirectory {
            relative_path,
            before,
            after,
        } => {
            expect_directory(&before, &relative_path)?;
            expect_missing(&after, &relative_path)?;
            remove_directory(&mut root, &relative_path)
        }
    }
}

fn expect_missing<'a>(snapshots: &'a [PathSnapshot], path: &str) -> NativeResult<()> {
    match snapshots {
        [PathSnapshot::Missing { relative_path }] if relative_path == path => Ok(()),
        _ => Err(NativeError::new("PRECONDITION_FAILED")),
    }
}

fn expect_directory<'a>(snapshots: &'a [PathSnapshot], path: &str) -> NativeResult<()> {
    match snapshots {
        [PathSnapshot::Directory { relative_path }] if relative_path == path => Ok(()),
        _ => Err(NativeError::new("PRECONDITION_FAILED")),
    }
}

fn expect_file<'a>(snapshots: &'a [PathSnapshot], path: &str) -> NativeResult<&'a str> {
    match snapshots {
        [PathSnapshot::File {
            relative_path,
            content,
            checksum,
        }] if relative_path == path && valid_checksum(checksum) && content.as_bytes().len() <= MAX_TEXT_BYTES => {
            Ok(content)
        }
        _ => Err(NativeError::new("PRECONDITION_FAILED")),
    }
}

fn expect_move_before<'a>(
    snapshots: &'a [PathSnapshot],
    source_path: &str,
    target_path: &str,
) -> NativeResult<&'a str> {
    match snapshots {
        [
            PathSnapshot::File {
                relative_path,
                content,
                checksum,
            },
            PathSnapshot::Missing {
                relative_path: target,
            },
        ] if relative_path == source_path
            && target == target_path
            && valid_checksum(checksum)
            && content.as_bytes().len() <= MAX_TEXT_BYTES => Ok(content),
        _ => Err(NativeError::new("PRECONDITION_FAILED")),
    }
}

fn expect_move_after(
    snapshots: &[PathSnapshot],
    source_path: &str,
    target_path: &str,
    content: &str,
) -> NativeResult<()> {
    match snapshots {
        [
            PathSnapshot::Missing {
                relative_path: source,
            },
            PathSnapshot::File {
                relative_path: target,
                content: target_content,
                checksum,
            },
        ] if source == source_path
            && target == target_path
            && target_content == content
            && valid_checksum(checksum) => Ok(()),
        _ => Err(NativeError::new("PRECONDITION_FAILED")),
    }
}

fn valid_checksum(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn open_project_root(root: &str) -> NativeResult<DirectoryChain> {
    let (drive, segments) = parse_root(root)?;
    let volume_path = format!("{}:\\", drive);
    let mut volume_wide: Vec<u16> = volume_path.encode_utf16().collect();
    volume_wide.push(0);
    let initial = unsafe {
        CreateFileW(
            volume_wide.as_ptr(),
            directory_lock_access(),
            FILE_SHARE_READ,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if is_invalid_handle(initial) {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let volume = OwnedHandle(initial);
    assert_directory(volume.raw())?;
    let mut chain = DirectoryChain {
        handles: vec![volume],
    };
    for (index, segment) in segments.iter().enumerate() {
        let child = if index + 1 == segments.len() {
            open_directory_mutation_at(chain.current(), segment)?
        } else {
            open_directory_at(chain.current(), segment)?
        };
        chain.handles.push(child);
    }
    Ok(chain)
}

fn verify_root_identity(root: &DirectoryChain, expected: &RootIdentity) -> NativeResult<()> {
    let expected_device = expected
        .device
        .parse::<u32>()
        .map_err(|_| NativeError::new("ROOT_IDENTITY_MISMATCH"))?;
    let expected_inode = expected
        .inode
        .parse::<u64>()
        .map_err(|_| NativeError::new("ROOT_IDENTITY_MISMATCH"))?;
    let actual = file_information(root.current())?;
    let actual_inode = ((actual.file_index_high as u64) << 32) | actual.file_index_low as u64;
    if actual.volume_serial_number != expected_device || actual_inode != expected_inode {
        return Err(NativeError::new("ROOT_IDENTITY_MISMATCH"));
    }
    Ok(())
}

fn parse_root(root: &str) -> NativeResult<(char, Vec<&str>)> {
    if root.len() > MAX_PATH_CHARS || root.contains('\0') || root.contains('/') {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    if root.starts_with("\\\\") || root.starts_with("\\??\\") || root.starts_with("\\\\?\\") {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let chars: Vec<char> = root.chars().collect();
    if chars.len() < 4 || !chars[0].is_ascii_alphabetic() || chars[1] != ':' || chars[2] != '\\' {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let rest = &root[3..];
    if rest.is_empty() || rest.ends_with('\\') {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let segments: Vec<&str> = rest.split('\\').collect();
    if segments.is_empty() || segments.iter().any(|segment| !valid_segment(segment)) {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    Ok((chars[0].to_ascii_uppercase(), segments))
}

fn split_relative_path(path: &str) -> NativeResult<Vec<&str>> {
    if path.is_empty()
        || path.len() > MAX_PATH_CHARS
        || path.contains('\0')
        || path.contains('\\')
        || path.starts_with('/')
        || path.starts_with("//")
        || path.starts_with("\\\\")
        || path.len() >= 2 && path.as_bytes()[1] == b':'
    {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.is_empty() || segments.iter().any(|segment| !valid_segment(segment)) {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    Ok(segments)
}

fn valid_segment(segment: &str) -> bool {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.ends_with('.')
        || segment.ends_with(' ')
        || segment.len() > 255
        || segment.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
    {
        return false;
    }
    let base = segment.split('.').next().unwrap_or_default().to_ascii_uppercase();
    !matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "CLOCK$"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn open_parent(root: &DirectoryChain, relative_path: &str) -> NativeResult<RelativeParent> {
    let segments = split_relative_path(relative_path)?;
    let leaf = segments
        .last()
        .ok_or_else(|| NativeError::new("PATH_REJECTED"))?
        .to_string();
    // The root chain is already retained by the caller. Keep every descendant
    // handle open too, so no path component can be replaced while in use.
    let mut branch = Vec::with_capacity(segments.len().saturating_sub(1));
    let mut parent = root.current();
    let parent_segments = &segments[..segments.len() - 1];
    for (index, segment) in parent_segments.iter().enumerate() {
        let next = if index + 1 == parent_segments.len() {
            open_directory_mutation_at(parent, segment)?
        } else {
            open_directory_at(parent, segment)?
        };
        parent = next.raw();
        branch.push(next);
    }
    Ok(RelativeParent {
        _branch: branch,
        parent,
        leaf,
    })
}

fn open_parent_pair(
    root: &DirectoryChain,
    source_path: &str,
    target_path: &str,
) -> NativeResult<ParentPair> {
    let source = split_relative_path(source_path)?;
    let target = split_relative_path(target_path)?;
    if source_path == target_path {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    let source_leaf = source
        .last()
        .ok_or_else(|| NativeError::new("PATH_REJECTED"))?
        .to_string();
    let target_leaf = target
        .last()
        .ok_or_else(|| NativeError::new("PATH_REJECTED"))?
        .to_string();
    let source_parent_segments = &source[..source.len() - 1];
    let target_parent_segments = &target[..target.len() - 1];
    let mut common_count = 0usize;
    while common_count < source_parent_segments.len()
        && common_count < target_parent_segments.len()
        && source_parent_segments[common_count] == target_parent_segments[common_count]
    {
        common_count += 1;
    }

    let mut common_branch = Vec::with_capacity(common_count);
    let mut common_parent = root.current();
    for (index, segment) in source_parent_segments[..common_count].iter().enumerate() {
        let requires_mutation = index + 1 == source_parent_segments.len()
            || index + 1 == target_parent_segments.len();
        let next = if requires_mutation {
            open_directory_mutation_at(common_parent, segment)?
        } else {
            open_directory_at(common_parent, segment)?
        };
        common_parent = next.raw();
        common_branch.push(next);
    }
    let source_branch = open_branch(common_parent, &source_parent_segments[common_count..])?;
    let target_branch = open_branch(common_parent, &target_parent_segments[common_count..])?;
    Ok(ParentPair {
        _common_branch: common_branch,
        common_parent,
        _source_branch: source_branch,
        _target_branch: target_branch,
        source_leaf,
        target_leaf,
    })
}

fn open_branch(parent: Handle, segments: &[&str]) -> NativeResult<Vec<OwnedHandle>> {
    let mut handles = Vec::with_capacity(segments.len());
    let mut current = parent;
    for (index, segment) in segments.iter().enumerate() {
        let next = if index + 1 == segments.len() {
            open_directory_mutation_at(current, segment)?
        } else {
            open_directory_at(current, segment)?
        };
        current = next.raw();
        handles.push(next);
    }
    Ok(handles)
}

fn directory_lock_access() -> u32 {
    FILE_READ_DATA | FILE_EXECUTE | FILE_READ_ATTRIBUTES | SYNCHRONIZE
}

fn directory_mutation_access() -> u32 {
    directory_lock_access() | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY
}

fn open_directory_at(parent: Handle, segment: &str) -> NativeResult<OwnedHandle> {
    open_directory_with_access(parent, segment, directory_lock_access())
}

fn open_directory_mutation_at(parent: Handle, segment: &str) -> NativeResult<OwnedHandle> {
    open_directory_with_access(parent, segment, directory_mutation_access())
}

fn open_directory_with_access(
    parent: Handle,
    segment: &str,
    desired_access: u32,
) -> NativeResult<OwnedHandle> {
    let handle = nt_open_relative(
        parent,
        segment,
        desired_access,
        FILE_OPEN,
        FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
    .map_err(map_open_status)?;
    assert_directory(handle.raw())?;
    Ok(handle)
}

fn open_file_at(parent: Handle, leaf: &str) -> NativeResult<OwnedHandle> {
    let handle = nt_open_relative(
        parent,
        leaf,
        FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
        FILE_OPEN,
        FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
    .map_err(map_open_status)?;
    assert_regular_file(handle.raw())?;
    Ok(handle)
}

fn open_file_read_at(parent: Handle, leaf: &str) -> NativeResult<OwnedHandle> {
    let handle = nt_open_relative(
        parent,
        leaf,
        FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_OPEN,
        FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
    .map_err(map_open_status)?;
    assert_regular_file(handle.raw())?;
    Ok(handle)
}

fn open_directory_target_at(parent: Handle, leaf: &str) -> NativeResult<OwnedHandle> {
    let handle = nt_open_relative(
        parent,
        leaf,
        FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
        FILE_OPEN,
        FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
    .map_err(map_open_status)?;
    assert_directory(handle.raw())?;
    Ok(handle)
}

fn create_directory_at(parent: Handle, leaf: &str) -> Result<OwnedHandle, NtStatus> {
    nt_open_relative(
        parent,
        leaf,
        directory_mutation_access(),
        FILE_CREATE,
        FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
}

fn create_file_at(parent: Handle, leaf: &str) -> Result<OwnedHandle, NtStatus> {
    nt_open_relative(
        parent,
        leaf,
        FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
        FILE_CREATE,
        FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    )
}

fn nt_open_relative(
    parent: Handle,
    name: &str,
    desired_access: u32,
    disposition: u32,
    options: u32,
    share_access: u32,
) -> Result<OwnedHandle, NtStatus> {
    let mut units: Vec<u16> = name.encode_utf16().collect();
    if units.is_empty() || units.len() > (u16::MAX as usize / 2) {
        return Err(STATUS_INVALID_PARAMETER);
    }
    let mut object_name = UnicodeString {
        length: (units.len() * 2) as u16,
        maximum_length: (units.len() * 2) as u16,
        buffer: units.as_mut_ptr(),
    };
    let mut attributes = ObjectAttributes {
        length: mem::size_of::<ObjectAttributes>() as u32,
        root_directory: parent,
        object_name: &mut object_name,
        attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        security_descriptor: ptr::null_mut(),
        security_quality_of_service: ptr::null_mut(),
    };
    let mut io_status = IoStatusBlock {
        status: 0,
        information: 0,
    };
    let mut handle = ptr::null_mut();
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            desired_access,
            &mut attributes,
            &mut io_status,
            ptr::null_mut(),
            0,
            share_access,
            disposition,
            options,
            ptr::null_mut(),
            0,
        )
    };
    if nt_success(status) && !is_invalid_handle(handle) {
        Ok(OwnedHandle(handle))
    } else {
        Err(status)
    }
}

fn map_open_status(status: NtStatus) -> NativeError {
    if status == STATUS_STOPPED_ON_SYMLINK {
        NativeError::new("REPARSE_POINT_REJECTED")
    } else if is_not_found(status) || status == STATUS_OBJECT_NAME_COLLISION {
        NativeError::new("PRECONDITION_FAILED")
    } else if status == STATUS_INVALID_PARAMETER || status == STATUS_NOT_SUPPORTED {
        NativeError::new("PATH_REJECTED")
    } else {
        NativeError::new("IO_ERROR")
    }
}

fn nt_success(status: NtStatus) -> bool {
    status >= 0
}

fn is_not_found(status: NtStatus) -> bool {
    matches!(
        status,
        STATUS_OBJECT_NAME_NOT_FOUND | STATUS_OBJECT_PATH_NOT_FOUND | STATUS_NO_SUCH_FILE
    )
}

fn is_invalid_handle(handle: Handle) -> bool {
    handle.is_null() || handle as isize == -1
}

fn file_information(handle: Handle) -> NativeResult<ByHandleFileInformation> {
    let mut information = ByHandleFileInformation::default();
    let ok = unsafe { GetFileInformationByHandle(handle, &mut information) };
    if ok == 0 {
        return Err(NativeError::new("IO_ERROR"));
    }
    Ok(information)
}

fn assert_directory(handle: Handle) -> NativeResult<ByHandleFileInformation> {
    let information = file_information(handle)?;
    if information.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(NativeError::new("REPARSE_POINT_REJECTED"));
    }
    if information.file_attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    Ok(information)
}

fn assert_regular_file(handle: Handle) -> NativeResult<ByHandleFileInformation> {
    let information = file_information(handle)?;
    if information.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(NativeError::new("REPARSE_POINT_REJECTED"));
    }
    if information.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    // A hard link under the project root can point at a file also named outside
    // it. Reject all multi-link files rather than guessing which link is safe.
    if information.number_of_links != 1 {
        return Err(NativeError::new("HARDLINK_REJECTED"));
    }
    Ok(information)
}

fn same_identity(left: &ByHandleFileInformation, right: &ByHandleFileInformation) -> bool {
    left.volume_serial_number == right.volume_serial_number
        && left.file_index_high == right.file_index_high
        && left.file_index_low == right.file_index_low
}

fn read_text(handle: Handle) -> NativeResult<String> {
    let info = assert_regular_file(handle)?;
    let size = ((info.file_size_high as u64) << 32) | info.file_size_low as u64;
    if size > MAX_TEXT_BYTES as u64 {
        return Err(NativeError::new("PRECONDITION_FAILED"));
    }
    seek_start(handle)?;
    let mut bytes = Vec::with_capacity(size as usize);
    let mut remaining = size as usize;
    while remaining > 0 {
        let chunk_len = remaining.min(64 * 1024);
        let mut chunk = vec![0u8; chunk_len];
        let mut read = 0u32;
        let ok = unsafe {
            ReadFile(
                handle,
                chunk.as_mut_ptr() as *mut c_void,
                chunk_len as u32,
                &mut read,
                ptr::null_mut(),
            )
        };
        if ok == 0 || read == 0 {
            return Err(NativeError::new("IO_ERROR"));
        }
        bytes.extend_from_slice(&chunk[..read as usize]);
        remaining = remaining.saturating_sub(read as usize);
    }
    if bytes.contains(&0) {
        return Err(NativeError::new("PRECONDITION_FAILED"));
    }
    String::from_utf8(bytes).map_err(|_| NativeError::new("PRECONDITION_FAILED"))
}

fn write_text(handle: Handle, content: &str) -> NativeResult<()> {
    let bytes = content.as_bytes();
    if bytes.len() > MAX_TEXT_BYTES || bytes.contains(&0) {
        return Err(NativeError::new("PATH_REJECTED"));
    }
    seek_start(handle)?;
    let truncated = unsafe { SetEndOfFile(handle) };
    if truncated == 0 {
        return Err(NativeError::new("IO_ERROR"));
    }
    let mut offset = 0usize;
    while offset < bytes.len() {
        let length = (bytes.len() - offset).min(64 * 1024);
        let mut written = 0u32;
        let ok = unsafe {
            WriteFile(
                handle,
                bytes[offset..offset + length].as_ptr() as *const c_void,
                length as u32,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 || written == 0 {
            return Err(NativeError::new("IO_ERROR"));
        }
        offset += written as usize;
    }
    let flushed = unsafe { FlushFileBuffers(handle) };
    if flushed == 0 {
        return Err(NativeError::new("IO_ERROR"));
    }
    Ok(())
}

fn seek_start(handle: Handle) -> NativeResult<()> {
    let mut position = 0i64;
    let ok = unsafe { SetFilePointerEx(handle, 0, &mut position, FILE_BEGIN) };
    if ok == 0 || position != 0 {
        return Err(NativeError::new("IO_ERROR"));
    }
    Ok(())
}

fn mark_for_delete(handle: Handle) -> NativeResult<()> {
    let mut information = FileDispositionInformation { delete_file: 1 };
    let mut io_status = IoStatusBlock {
        status: 0,
        information: 0,
    };
    let status = unsafe {
        NtSetInformationFile(
            handle,
            &mut io_status,
            &mut information as *mut FileDispositionInformation as *mut c_void,
            mem::size_of::<FileDispositionInformation>() as u32,
            FILE_DISPOSITION_INFORMATION,
        )
    };
    if nt_success(status) {
        Ok(())
    } else {
        Err(NativeError::new("IO_ERROR"))
    }
}

fn create_temp_file(parent: Handle) -> NativeResult<(OwnedHandle, String)> {
    for _ in 0..64 {
        let name = temporary_leaf();
        match create_file_at(parent, &name) {
            Ok(handle) => return Ok((handle, name)),
            Err(STATUS_OBJECT_NAME_COLLISION) => continue,
            Err(status) => return Err(map_open_status(status)),
        }
    }
    Err(NativeError::new("IO_ERROR"))
}

fn temporary_leaf() -> String {
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        ".novel-studio-agent-{}-{}-{}.tmp",
        std::process::id(),
        nanos,
        sequence
    )
}

fn discard_temp(handle: OwnedHandle) {
    let _ = mark_for_delete(handle.raw());
    drop(handle);
}

fn rename_handle(
    source: Handle,
    target_parent: Handle,
    target_leaf: &str,
    replace_existing: bool,
) -> Result<(), NtStatus> {
    let target_units: Vec<u16> = target_leaf.encode_utf16().collect();
    if target_units.is_empty() || target_units.len() > (u32::MAX as usize / 2) {
        return Err(STATUS_INVALID_PARAMETER);
    }
    // FILE_RENAME_INFORMATION is pointer-width aligned: BOOLEAN at offset 0,
    // RootDirectory at the next pointer boundary, then ULONG and WCHAR data.
    let root_offset = mem::size_of::<usize>();
    let length_offset = root_offset + mem::size_of::<usize>();
    let name_offset = length_offset + mem::size_of::<u32>();
    let required_len = name_offset + target_units.len() * mem::size_of::<u16>();
    // Vec<u8> has only byte alignment. NtSetInformationFile consumes a header
    // containing a HANDLE, so back the byte view with pointer-width storage.
    let mut storage = vec![0usize; required_len.div_ceil(mem::size_of::<usize>())];
    let bytes = unsafe {
        slice::from_raw_parts_mut(
            storage.as_mut_ptr() as *mut u8,
            storage.len() * mem::size_of::<usize>(),
        )
    };
    if replace_existing {
        let flags = FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS;
        bytes[..mem::size_of::<u32>()].copy_from_slice(&flags.to_ne_bytes());
    }
    let raw_parent = target_parent as usize;
    bytes[root_offset..root_offset + mem::size_of::<usize>()]
        .copy_from_slice(&raw_parent.to_ne_bytes());
    let name_length = (target_units.len() * mem::size_of::<u16>()) as u32;
    bytes[length_offset..length_offset + mem::size_of::<u32>()]
        .copy_from_slice(&name_length.to_ne_bytes());
    for (index, unit) in target_units.iter().enumerate() {
        let offset = name_offset + index * mem::size_of::<u16>();
        bytes[offset..offset + mem::size_of::<u16>()].copy_from_slice(&unit.to_ne_bytes());
    }
    let mut io_status = IoStatusBlock {
        status: 0,
        information: 0,
    };
    let information_class = if replace_existing {
        FILE_RENAME_INFORMATION_EX
    } else {
        FILE_RENAME_INFORMATION
    };
    let status = unsafe {
        NtSetInformationFile(
            source,
            &mut io_status,
            bytes.as_mut_ptr() as *mut c_void,
            required_len as u32,
            information_class,
        )
    };
    if nt_success(status) {
        Ok(())
    } else {
        Err(status)
    }
}

fn map_rename_status(status: NtStatus) -> NativeError {
    if status == STATUS_INVALID_INFO_CLASS || status == STATUS_NOT_SUPPORTED || status == STATUS_INVALID_PARAMETER {
        NativeError::new("ATOMIC_REPLACE_UNSUPPORTED")
    } else if is_not_found(status) || status == STATUS_OBJECT_NAME_COLLISION {
        NativeError::new("PRECONDITION_FAILED")
    } else {
        NativeError::new("IO_ERROR")
    }
}

fn create_file(root: &DirectoryChain, relative_path: &str, content: &str) -> NativeResult<()> {
    let parent = open_parent(root, relative_path)?;
    create_file_in_parent(parent.parent, &parent.leaf, content)
}

fn create_file_in_parent(parent: Handle, leaf: &str, content: &str) -> NativeResult<()> {
    let (temporary, _) = create_temp_file(parent)?;
    if let Err(error) = write_text(temporary.raw(), content) {
        discard_temp(temporary);
        return Err(error);
    }
    if read_text(temporary.raw())? != content {
        discard_temp(temporary);
        return Err(NativeError::new("POSTCONDITION_FAILED"));
    }
    if let Err(status) = rename_handle(temporary.raw(), parent, leaf, false) {
        discard_temp(temporary);
        return Err(map_rename_status(status));
    }
    let target = open_file_read_at(parent, leaf)?;
    if !same_identity(&file_information(temporary.raw())?, &file_information(target.raw())?)
        || read_text(target.raw())? != content
    {
        return Err(NativeError::new("POSTCONDITION_FAILED"));
    }
    Ok(())
}

fn replace_file(
    root: &DirectoryChain,
    relative_path: &str,
    expected_before: &str,
    content: &str,
) -> NativeResult<()> {
    let parent = open_parent(root, relative_path)?;
    let original = open_file_at(parent.parent, &parent.leaf)?;
    if read_text(original.raw())? != expected_before {
        return Err(NativeError::new("PRECONDITION_FAILED"));
    }
    replace_open_file(parent.parent, &parent.leaf, original, content)
}

fn replace_open_file(
    parent: Handle,
    leaf: &str,
    original: OwnedHandle,
    content: &str,
) -> NativeResult<()> {
    let original_identity = file_information(original.raw())?;
    let (temporary, _) = create_temp_file(parent)?;
    if let Err(error) = write_text(temporary.raw(), content) {
        discard_temp(temporary);
        return Err(error);
    }
    if read_text(temporary.raw())? != content {
        discard_temp(temporary);
        return Err(NativeError::new("POSTCONDITION_FAILED"));
    }
    if let Err(status) = rename_handle(temporary.raw(), parent, leaf, true) {
        discard_temp(temporary);
        return Err(map_rename_status(status));
    }

    let target = match open_file_read_at(parent, leaf) {
        Ok(handle) => handle,
        Err(error) => {
            let _ = rename_handle(original.raw(), parent, leaf, true);
            return Err(error);
        }
    };
    let postcondition = (|| -> NativeResult<()> {
        let target_identity = file_information(target.raw())?;
        if !same_identity(&target_identity, &file_information(temporary.raw())?)
            || same_identity(&target_identity, &original_identity)
            || read_text(target.raw())? != content
        {
            return Err(NativeError::new("POSTCONDITION_FAILED"));
        }
        Ok(())
    })();
    drop(target);
    if let Err(error) = postcondition {
        // POSIX replacement keeps the prior file reachable through its open
        // handle. Restore it atomically before reporting the failed mutation.
        if rename_handle(original.raw(), parent, leaf, true).is_err() {
            return Err(NativeError::new("ROLLBACK_FAILED"));
        }
        return Err(error);
    }
    drop(original);
    drop(temporary);
    Ok(())
}

fn move_file(
    root: &DirectoryChain,
    source_path: &str,
    target_path: &str,
    expected_content: &str,
) -> NativeResult<()> {
    let parents = open_parent_pair(root, source_path, target_path)?;
    let source = open_file_at(parents.source_parent(), &parents.source_leaf)?;
    if read_text(source.raw())? != expected_content {
        return Err(NativeError::new("PRECONDITION_FAILED"));
    }
    let source_identity = file_information(source.raw())?;
    if let Err(status) = rename_handle(
        source.raw(),
        parents.target_parent(),
        &parents.target_leaf,
        false,
    ) {
        return Err(map_rename_status(status));
    }
    // Parent handles deny sharing writes, so these observations cannot be
    // changed by another process before the mutation returns.
    ensure_missing(parents.source_parent(), &parents.source_leaf)?;
    let target = open_file_read_at(parents.target_parent(), &parents.target_leaf)?;
    if !same_identity(&source_identity, &file_information(target.raw())?)
        || read_text(target.raw())? != expected_content
    {
        return Err(NativeError::new("POSTCONDITION_FAILED"));
    }
    Ok(())
}

fn delete_file(root: &DirectoryChain, relative_path: &str, expected_content: &str) -> NativeResult<()> {
    let parent = open_parent(root, relative_path)?;
    let target = open_file_at(parent.parent, &parent.leaf)?;
    if read_text(target.raw())? != expected_content {
        return Err(NativeError::new("PRECONDITION_FAILED"));
    }
    mark_for_delete(target.raw())?;
    drop(target);
    ensure_missing(parent.parent, &parent.leaf)
}

fn create_directory(root: &DirectoryChain, relative_path: &str) -> NativeResult<()> {
    let parent = open_parent(root, relative_path)?;
    let target = create_directory_at(parent.parent, &parent.leaf).map_err(map_open_status)?;
    assert_directory(target.raw())?;
    drop(target);
    let verified = open_directory_target_at(parent.parent, &parent.leaf)?;
    assert_directory(verified.raw())?;
    Ok(())
}

fn remove_directory(root: &DirectoryChain, relative_path: &str) -> NativeResult<()> {
    let parent = open_parent(root, relative_path)?;
    let target = open_directory_target_at(parent.parent, &parent.leaf)?;
    mark_for_delete(target.raw())?;
    drop(target);
    ensure_missing(parent.parent, &parent.leaf)
}

fn ensure_missing(parent: Handle, leaf: &str) -> NativeResult<()> {
    match nt_open_relative(
        parent,
        leaf,
        FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_OPEN,
        FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
        FILE_SHARE_READ,
    ) {
        Ok(handle) => {
            drop(handle);
            Err(NativeError::new("POSTCONDITION_FAILED"))
        }
        Err(status) if is_not_found(status) => Ok(()),
        Err(_) => Err(NativeError::new("IO_ERROR")),
    }
}
