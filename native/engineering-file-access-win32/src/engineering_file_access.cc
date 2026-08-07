#include <node_api.h>

#ifdef _WIN32
#include <windows.h>
#include <winternl.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstddef>
#include <cwctype>
#include <cwchar>
#include <limits>
#include <mutex>
#include <new>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#endif

namespace {

#ifdef _WIN32
constexpr uint64_t kMaxFileBytes = 5ULL * 1024ULL * 1024ULL;
constexpr size_t kMaxPathUtf8Bytes = 4096;
constexpr size_t kMaxRelativeUtf16Units = 4096;
constexpr size_t kMaxRootUtf16Units = 4096;
constexpr size_t kMaxQueryUtf16Units = 1024;
constexpr size_t kMaxSegments = 64;
constexpr size_t kMaxSearchQueryUtf8Bytes = 1024;
constexpr size_t kMaxIndexEntries = 10'000;
constexpr size_t kMaxDirectoryEntries = 10'000;
constexpr size_t kMaxSearchResults = 1'000;
constexpr size_t kMaxDepth = 32;
constexpr uint64_t kMaxScanBytes = 32ULL * 1024ULL * 1024ULL;
constexpr NTSTATUS kStatusNoMoreFiles = static_cast<NTSTATUS>(0x80000006L);
constexpr ULONG kFileBothDirectoryInformation = 3;
constexpr ULONG kFileOpen = 1;
constexpr ULONG kFileDirectoryFile = 0x00000001;
constexpr ULONG kFileSynchronousIoNonAlert = 0x00000020;
constexpr ULONG kFileNonDirectoryFile = 0x00000040;
constexpr ULONG kFileOpenReparsePoint = 0x00200000;

struct NativeFileBothDirectoryInformation {
  ULONG nextEntryOffset;
  ULONG fileIndex;
  LARGE_INTEGER creationTime;
  LARGE_INTEGER lastAccessTime;
  LARGE_INTEGER lastWriteTime;
  LARGE_INTEGER changeTime;
  LARGE_INTEGER endOfFile;
  LARGE_INTEGER allocationSize;
  ULONG fileAttributes;
  ULONG fileNameLength;
  ULONG eaSize;
  CCHAR shortNameLength;
  WCHAR shortName[12];
  WCHAR fileName[1];
};

using NtCreateFileFn = NTSTATUS(NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
                                          PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtQueryDirectoryFileFn = NTSTATUS(NTAPI *)(HANDLE, HANDLE, PIO_APC_ROUTINE, PVOID, PIO_STATUS_BLOCK,
                                                  PVOID, ULONG, ULONG, BOOLEAN, PUNICODE_STRING, BOOLEAN);

struct RootSession {
  HANDLE handle;
  std::wstring path;
  BY_HANDLE_FILE_INFORMATION identity;
};

std::mutex g_rootsMutex;
std::unordered_map<uint64_t, RootSession> g_roots;
std::atomic<uint64_t> g_nextRoot{1};

enum class AccessError {
  kOk,
  kInvalidArgument,
  kRootUnavailable,
  kRootChanged,
  kUnsafePath,
  kUnavailable,
  kNotFound,
  kUnsafeObject,
  kNotText,
  kTooLarge,
  kScanLimit,
  kResourceLimit,
  kChanged,
  kIo
};

struct Entry {
  std::wstring name;
  bool directory;
  uint64_t byteLength;
};

struct Snapshot {
  std::wstring relativePath;
  uint64_t byteLength;
};

struct ScanBudget {
  size_t entriesRemaining = kMaxIndexEntries;
  uint64_t bytesRemaining = kMaxScanBytes;
};

bool consumeEntry(ScanBudget* budget) {
  if (budget == nullptr) return true;
  if (budget->entriesRemaining == 0) return false;
  --budget->entriesRemaining;
  return true;
}

bool consumeBytes(ScanBudget* budget, uint64_t bytes) {
  if (budget == nullptr) return true;
  if (bytes > budget->bytesRemaining) return false;
  budget->bytesRemaining -= bytes;
  return true;
}

const char* errorCode(AccessError error) {
  switch (error) {
    case AccessError::kInvalidArgument: return "ENGINEERING_ACCESS_INVALID_ARGUMENT";
    case AccessError::kRootUnavailable: return "ENGINEERING_ACCESS_ROOT_UNAVAILABLE";
    case AccessError::kRootChanged: return "ENGINEERING_ACCESS_ROOT_CHANGED";
    case AccessError::kUnsafePath: return "ENGINEERING_ACCESS_UNSAFE_PATH";
    case AccessError::kUnavailable: return "ENGINEERING_ACCESS_UNAVAILABLE";
    case AccessError::kNotFound: return "ENGINEERING_ACCESS_NOT_FOUND";
    case AccessError::kUnsafeObject: return "ENGINEERING_ACCESS_UNSAFE_OBJECT";
    case AccessError::kNotText: return "ENGINEERING_ACCESS_NOT_UTF8_TEXT";
    case AccessError::kTooLarge: return "ENGINEERING_ACCESS_FILE_TOO_LARGE";
    case AccessError::kScanLimit: return "ENGINEERING_ACCESS_SCAN_LIMIT";
    case AccessError::kResourceLimit: return "ENGINEERING_ACCESS_RESOURCE_LIMIT";
    case AccessError::kChanged: return "ENGINEERING_ACCESS_CHANGED_DURING_READ";
    case AccessError::kIo: return "ENGINEERING_ACCESS_IO_FAILED";
  }
  return "ENGINEERING_ACCESS_UNAVAILABLE";
}

void throwAccessError(napi_env env, AccessError error) {
  napi_throw_error(env, errorCode(error), errorCode(error));
}

void closeRoots() {
  std::scoped_lock lock(g_rootsMutex);
  for (const auto& [id, session] : g_roots) {
    (void)id;
    if (session.handle != INVALID_HANDLE_VALUE) CloseHandle(session.handle);
  }
  g_roots.clear();
}

bool wideToUtf8(const std::wstring& input, std::string* output) {
  if (input.empty()) {
    output->clear();
    return true;
  }
  const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                                            static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) return false;
  output->resize(static_cast<size_t>(required));
  return WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()),
                             output->data(), required, nullptr, nullptr) == required;
}

bool readUtf16String(napi_env env, napi_value value, size_t maxUnits, std::wstring* output) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok ||
      length > maxUnits || length > static_cast<size_t>(std::numeric_limits<int>::max())) return false;
  std::vector<char16_t> buffer(length + 1, u'\0');
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) return false;
  output->clear();
  output->reserve(length);
  for (size_t index = 0; index < length; ++index) output->push_back(static_cast<wchar_t>(buffer[index]));
  std::string utf8;
  return wideToUtf8(*output, &utf8);
}

bool isForbiddenFormatCharacter(wchar_t c) {
  const unsigned value = static_cast<unsigned>(c);
  return value == 0x00ad || value == 0x034f || (value >= 0x0600 && value <= 0x0605) || value == 0x061c ||
      value == 0x06dd || value == 0x070f || (value >= 0x0890 && value <= 0x0891) || value == 0x08e2 || value == 0x180e ||
      value == 0x200b || value == 0x200c || value == 0x200d || (value >= 0x200e && value <= 0x200f) ||
      (value >= 0x202a && value <= 0x202e) || (value >= 0x2060 && value <= 0x206f) ||
      value == 0xfeff || (value >= 0xfff9 && value <= 0xfffb);
}

bool isReservedDeviceName(const std::wstring& name) {
  const size_t dot = name.find(L'.');
  std::wstring base = name.substr(0, dot);
  std::transform(base.begin(), base.end(), base.begin(), [](wchar_t c) { return static_cast<wchar_t>(towupper(c)); });
  if (base == L"CON" || base == L"PRN" || base == L"AUX" || base == L"NUL" || base == L"CLOCK$" ||
      base == L"CONIN$" || base == L"CONOUT$") return true;
  if (base.size() == 4 && (base.rfind(L"COM", 0) == 0 || base.rfind(L"LPT", 0) == 0) &&
      base[3] >= L'1' && base[3] <= L'9') return true;
  return false;
}

bool isPathTokenSeparator(wchar_t value) {
  return value == L'.' || value == L'_' || value == L'-';
}

bool hasDelimitedToken(const std::wstring& name, const std::wstring& token) {
  size_t start = 0;
  while ((start = name.find(token, start)) != std::wstring::npos) {
    const size_t end = start + token.size();
    if ((start == 0 || isPathTokenSeparator(name[start - 1])) &&
        (end == name.size() || isPathTokenSeparator(name[end]))) return true;
    ++start;
  }
  return false;
}

bool isPublicEnvironmentTemplate(const std::wstring& lower) {
  return lower == L".env.example" || lower == L".env.sample" || lower == L".env.template";
}

bool hasPrivateKeyExtension(const std::wstring& lower) {
  constexpr const wchar_t* kExtensions[] = {L".key", L".pem", L".p12", L".pfx", L".pkcs12"};
  for (const wchar_t* extension : kExtensions) {
    const size_t length = std::wcslen(extension);
    if (lower.size() > length && lower.compare(lower.size() - length, length, extension) == 0) return true;
  }
  return false;
}

// This mirrors the fixed hard-denied categories in engineering-path-policy.ts. It is deliberately
// evaluated by both parsing and native enumeration/opening; failures expose only a stable error code.
bool isHardDeniedName(const std::wstring& name) {
  std::wstring lower = name;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
  if (lower == L".git" || lower == L".novel-studio" || lower == L".novel-studio-state" ||
      lower == L".novel-studio-journal" || lower == L".novel-studio-recovery" ||
      lower == L".novel-studio-quarantine" || lower == L".novel-studio-history") return true;
  if (isPublicEnvironmentTemplate(lower)) return false;
  if (lower == L".env" || lower.rfind(L".env.", 0) == 0 || hasPrivateKeyExtension(lower)) return true;
  constexpr const wchar_t* kSensitiveTokens[] = {L"secret", L"secrets", L"credential", L"credentials", L"password"};
  for (const wchar_t* token : kSensitiveTokens) if (hasDelimitedToken(lower, token)) return true;
  return hasDelimitedToken(lower, L"private_key") || hasDelimitedToken(lower, L"private-key") ||
      hasDelimitedToken(lower, L"privatekey") || hasDelimitedToken(lower, L"id_rsa") ||
      hasDelimitedToken(lower, L"id_dsa") || hasDelimitedToken(lower, L"id_ecdsa") ||
      hasDelimitedToken(lower, L"id_ed25519");
}

bool isCanonicalLeafName(const std::wstring& name) {
  if (name.empty() || name.size() > 255 || name == L"." || name == L".." || name.back() == L'.' || name.back() == L' ' ||
      isReservedDeviceName(name)) return false;
  std::string utf8;
  if (!wideToUtf8(name, &utf8) || utf8.empty() || utf8.size() > 255) return false;
  const int normalizedLength = NormalizeString(NormalizationC, name.data(), static_cast<int>(name.size()), nullptr, 0);
  if (normalizedLength <= 0 || normalizedLength != static_cast<int>(name.size())) return false;
  std::wstring normalized(static_cast<size_t>(normalizedLength), L'\0');
  if (NormalizeString(NormalizationC, name.data(), static_cast<int>(name.size()), normalized.data(), normalizedLength) != normalizedLength ||
      normalized != name) return false;
  for (wchar_t c : name) {
    const unsigned value = static_cast<unsigned>(c);
    if ((value <= 0x1f) || (value >= 0x7f && value <= 0x9f) || (value >= 0xd800 && value <= 0xdfff) ||
        isForbiddenFormatCharacter(c) || c == L'<' || c == L'>' || c == L':' || c == L'"' || c == L'/' || c == L'\\' ||
        c == L'|' || c == L'?' || c == L'*') return false;
  }
  return true;
}

bool parseRelativePath(const std::wstring& relative, bool allowEmpty, std::vector<std::wstring>* segments) {
  segments->clear();
  if (relative.empty()) return allowEmpty;
  std::string utf8;
  if (relative.size() > kMaxRelativeUtf16Units || !wideToUtf8(relative, &utf8) || utf8.size() > kMaxPathUtf8Bytes || relative.front() == L'/' ||
      relative.find(L'\\') != std::wstring::npos || relative.find(L':') != std::wstring::npos) return false;
  size_t start = 0;
  while (start < relative.size()) {
    const size_t end = relative.find(L'/', start);
    const std::wstring segment = relative.substr(start, end == std::wstring::npos ? end : end - start);
    if (!isCanonicalLeafName(segment) || isHardDeniedName(segment) || segments->size() >= kMaxSegments) return false;
    segments->push_back(segment);
    start = end == std::wstring::npos ? relative.size() : end + 1;
  }
  return !segments->empty();
}

bool isSafeRootPath(const std::wstring& root) {
  if (root.size() < 3 || root[1] != L':' || (root[2] != L'\\' && root[2] != L'/')) return false;
  if ((root[0] < L'A' || root[0] > L'Z') && (root[0] < L'a' || root[0] > L'z')) return false;
  return root.find(L':', 2) == std::wstring::npos && root.rfind(L"\\\\", 0) != 0 &&
      root.rfind(L"\\\\?\\", 0) != 0 && root.rfind(L"\\\\.\\", 0) != 0;
}

bool isSuccess(NTSTATUS status) { return status >= 0; }

NtCreateFileFn ntCreateFile() {
#pragma warning(suppress : 4191)
  static const auto fn = reinterpret_cast<NtCreateFileFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile"));
  return fn;
}

NtQueryDirectoryFileFn ntQueryDirectoryFile() {
#pragma warning(suppress : 4191)
  static const auto fn = reinterpret_cast<NtQueryDirectoryFileFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryDirectoryFile"));
  return fn;
}

bool fileAttributes(HANDLE handle, FILE_ATTRIBUTE_TAG_INFO* attributes, FILE_STANDARD_INFO* standard,
                    BY_HANDLE_FILE_INFORMATION* identity) {
  return GetFileInformationByHandleEx(handle, FileAttributeTagInfo, attributes, sizeof(*attributes)) != FALSE &&
      GetFileInformationByHandleEx(handle, FileStandardInfo, standard, sizeof(*standard)) != FALSE &&
      GetFileInformationByHandle(handle, identity) != FALSE;
}

bool hasExactLeafName(HANDLE handle, const std::wstring& expected) {
  std::vector<unsigned char> storage(64 * 1024);
  auto* info = reinterpret_cast<FILE_NAME_INFO*>(storage.data());
  if (!GetFileInformationByHandleEx(handle, FileNameInfo, info, static_cast<DWORD>(storage.size()))) return false;
  if (info->FileNameLength == 0 || info->FileNameLength % sizeof(wchar_t) != 0) return false;
  const std::wstring name(info->FileName, info->FileNameLength / sizeof(wchar_t));
  const size_t separator = name.find_last_of(L"\\/");
  return name.substr(separator == std::wstring::npos ? 0 : separator + 1) == expected;
}

AccessError verifyDirectory(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!fileAttributes(handle, &attributes, &standard, &identity)) return AccessError::kIo;
  if (!standard.Directory || (attributes.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE)) != 0 ||
      GetFileType(handle) != FILE_TYPE_DISK) return AccessError::kUnsafeObject;
  return AccessError::kOk;
}

AccessError verifyRegularFile(HANDLE handle, uint64_t* size) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!fileAttributes(handle, &attributes, &standard, &identity)) return AccessError::kIo;
  if (standard.Directory || (attributes.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_SPARSE_FILE)) != 0 ||
      identity.nNumberOfLinks != 1 || GetFileType(handle) != FILE_TYPE_DISK || standard.EndOfFile.QuadPart < 0) return AccessError::kUnsafeObject;
  *size = static_cast<uint64_t>(standard.EndOfFile.QuadPart);
  return *size > kMaxFileBytes ? AccessError::kTooLarge : AccessError::kOk;
}

AccessError duplicateRoot(uint64_t rootId, HANDLE* output) {
  std::scoped_lock lock(g_rootsMutex);
  const auto found = g_roots.find(rootId);
  if (found == g_roots.end()) return AccessError::kRootUnavailable;
  HANDLE currentRoot = CreateFileW(found->second.path.c_str(), FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                   FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (currentRoot == INVALID_HANDLE_VALUE) return AccessError::kRootChanged;
  BY_HANDLE_FILE_INFORMATION currentIdentity{};
  const AccessError currentChecked = verifyDirectory(currentRoot);
  const bool sameRoot = currentChecked == AccessError::kOk && GetFileInformationByHandle(currentRoot, &currentIdentity) != FALSE &&
      currentIdentity.dwVolumeSerialNumber == found->second.identity.dwVolumeSerialNumber &&
      currentIdentity.nFileIndexHigh == found->second.identity.nFileIndexHigh &&
      currentIdentity.nFileIndexLow == found->second.identity.nFileIndexLow;
  CloseHandle(currentRoot);
  if (!sameRoot) return AccessError::kRootChanged;
  HANDLE duplicate = INVALID_HANDLE_VALUE;
  if (!DuplicateHandle(GetCurrentProcess(), found->second.handle, GetCurrentProcess(), &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS))
    return AccessError::kIo;
  const AccessError checked = verifyDirectory(duplicate);
  if (checked != AccessError::kOk) {
    CloseHandle(duplicate);
    return checked;
  }
  *output = duplicate;
  return AccessError::kOk;
}

AccessError verifyRootStillCurrent(uint64_t rootId) {
  HANDLE duplicate = INVALID_HANDLE_VALUE;
  const AccessError result = duplicateRoot(rootId, &duplicate);
  if (result == AccessError::kOk) CloseHandle(duplicate);
  return result;
}

AccessError openRelative(HANDLE root, const std::vector<std::wstring>& segments, bool directory, HANDLE* output) {
  HANDLE current = root;
  bool ownsCurrent = false;
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) return AccessError::kUnavailable;
  for (size_t index = 0; index < segments.size(); ++index) {
    if (!isCanonicalLeafName(segments[index]) || isHardDeniedName(segments[index])) return AccessError::kUnsafePath;
    UNICODE_STRING name{};
    name.Buffer = const_cast<PWSTR>(segments[index].data());
    name.Length = static_cast<USHORT>(segments[index].size() * sizeof(wchar_t));
    name.MaximumLength = name.Length;
    OBJECT_ATTRIBUTES objectAttributes{};
    InitializeObjectAttributes(&objectAttributes, &name, OBJ_CASE_INSENSITIVE, current, nullptr);
    IO_STATUS_BLOCK statusBlock{};
    HANDLE next = INVALID_HANDLE_VALUE;
    const bool expectedDirectory = index + 1 < segments.size() || directory;
    const NTSTATUS status = create(&next,
        expectedDirectory ? (FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                          : (FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE),
        &objectAttributes, &statusBlock, nullptr, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        kFileOpen, expectedDirectory ? (kFileDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint)
                                     : (kFileNonDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint),
        nullptr, 0);
    if (ownsCurrent) CloseHandle(current);
    if (!isSuccess(status) || next == INVALID_HANDLE_VALUE) return status == static_cast<NTSTATUS>(0xC0000034L) ? AccessError::kNotFound : AccessError::kUnsafeObject;
    current = next;
    ownsCurrent = true;
    uint64_t ignoredSize = 0;
    const AccessError checked = expectedDirectory ? verifyDirectory(current) : verifyRegularFile(current, &ignoredSize);
    // Do not permit a case-folded or short-name alias to become a canonical ref.
    if (checked != AccessError::kOk || !hasExactLeafName(current, segments[index])) {
      CloseHandle(current);
      return checked == AccessError::kOk ? AccessError::kUnsafePath : checked;
    }
  }
  *output = current;
  return AccessError::kOk;
}

AccessError openDirectory(uint64_t rootId, const std::wstring& relative, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseRelativePath(relative, true, &segments)) return AccessError::kUnsafePath;
  HANDLE root = INVALID_HANDLE_VALUE;
  AccessError result = duplicateRoot(rootId, &root);
  if (result != AccessError::kOk) return result;
  if (segments.empty()) {
    *output = root;
    return AccessError::kOk;
  }
  result = openRelative(root, segments, true, output);
  CloseHandle(root);
  return result;
}

AccessError openFile(uint64_t rootId, const std::wstring& relative, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseRelativePath(relative, false, &segments)) return AccessError::kUnsafePath;
  HANDLE root = INVALID_HANDLE_VALUE;
  AccessError result = duplicateRoot(rootId, &root);
  if (result != AccessError::kOk) return result;
  result = openRelative(root, segments, false, output);
  CloseHandle(root);
  return result;
}

bool isUtf8Text(const std::string& bytes) {
  for (size_t i = 0; i < bytes.size();) {
    const unsigned char first = static_cast<unsigned char>(bytes[i]);
    if (first == 0) return false;
    if (first <= 0x7f) { ++i; continue; }
    size_t count = 0;
    uint32_t codePoint = 0;
    if (first >= 0xc2 && first <= 0xdf) { count = 2; codePoint = first & 0x1f; }
    else if (first >= 0xe0 && first <= 0xef) { count = 3; codePoint = first & 0x0f; }
    else if (first >= 0xf0 && first <= 0xf4) { count = 4; codePoint = first & 0x07; }
    else return false;
    if (i + count > bytes.size()) return false;
    for (size_t offset = 1; offset < count; ++offset) {
      const unsigned char next = static_cast<unsigned char>(bytes[i + offset]);
      if ((next & 0xc0) != 0x80) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if ((count == 2 && codePoint < 0x80) || (count == 3 && codePoint < 0x800) ||
        (count == 4 && codePoint < 0x10000) || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
    i += count;
  }
  return true;
}

bool sameIdentity(const BY_HANDLE_FILE_INFORMATION& left, const BY_HANDLE_FILE_INFORMATION& right) {
  return left.dwVolumeSerialNumber == right.dwVolumeSerialNumber && left.nFileIndexHigh == right.nFileIndexHigh &&
      left.nFileIndexLow == right.nFileIndexLow && left.nFileSizeHigh == right.nFileSizeHigh &&
      left.nFileSizeLow == right.nFileSizeLow && left.ftLastWriteTime.dwHighDateTime == right.ftLastWriteTime.dwHighDateTime &&
      left.ftLastWriteTime.dwLowDateTime == right.ftLastWriteTime.dwLowDateTime && left.nNumberOfLinks == right.nNumberOfLinks;
}

AccessError readOpenedFile(HANDLE handle, ScanBudget* budget, std::string* bytes) {
  uint64_t size = 0;
  AccessError verified = verifyRegularFile(handle, &size);
  if (verified != AccessError::kOk) return verified;
  if (!consumeBytes(budget, size)) return AccessError::kScanLimit;
  BY_HANDLE_FILE_INFORMATION before{};
  if (!GetFileInformationByHandle(handle, &before)) return AccessError::kIo;
  bytes->assign(static_cast<size_t>(size), '\0');
  size_t offset = 0;
  while (offset < bytes->size()) {
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(64 * 1024, bytes->size() - offset));
    DWORD read = 0;
    if (!ReadFile(handle, bytes->data() + offset, requested, &read, nullptr) || read == 0) return AccessError::kIo;
    offset += read;
  }
  BY_HANDLE_FILE_INFORMATION after{};
  if (!GetFileInformationByHandle(handle, &after)) return AccessError::kIo;
  if (!sameIdentity(before, after)) return AccessError::kChanged;
  return isUtf8Text(*bytes) ? AccessError::kOk : AccessError::kNotText;
}

AccessError enumerateDirectory(HANDLE directory, ScanBudget* budget, std::vector<Entry>* output) {
  const NtQueryDirectoryFileFn query = ntQueryDirectoryFile();
  if (query == nullptr) return AccessError::kUnavailable;
  std::vector<unsigned char> buffer(64 * 1024);
  bool restart = true;
  for (;;) {
    IO_STATUS_BLOCK statusBlock{};
    const NTSTATUS status = query(directory, nullptr, nullptr, nullptr, &statusBlock, buffer.data(),
                                  static_cast<ULONG>(buffer.size()), kFileBothDirectoryInformation, FALSE, nullptr,
                                  restart ? TRUE : FALSE);
    restart = false;
    if (status == kStatusNoMoreFiles) return AccessError::kOk;
    if (!isSuccess(status)) return AccessError::kIo;
    size_t offset = 0;
    const size_t received = static_cast<size_t>(statusBlock.Information);
    while (offset < received) {
      if (received - offset < offsetof(NativeFileBothDirectoryInformation, fileName)) return AccessError::kIo;
      const auto* information = reinterpret_cast<const NativeFileBothDirectoryInformation*>(buffer.data() + offset);
      if (information->fileNameLength % sizeof(wchar_t) != 0 ||
          offsetof(NativeFileBothDirectoryInformation, fileName) + information->fileNameLength > received - offset) return AccessError::kIo;
      if (!consumeEntry(budget)) return AccessError::kScanLimit;
      const std::wstring name(information->fileName, information->fileNameLength / sizeof(wchar_t));
      if (isCanonicalLeafName(name) && !isHardDeniedName(name)) {
        if (output->size() >= kMaxDirectoryEntries) return AccessError::kScanLimit;
        output->push_back({name, (information->fileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0,
                           information->endOfFile.QuadPart < 0 ? 0 : static_cast<uint64_t>(information->endOfFile.QuadPart)});
      }
      if (information->nextEntryOffset == 0) break;
      if (information->nextEntryOffset > received - offset) return AccessError::kIo;
      offset += information->nextEntryOffset;
    }
  }
}

AccessError safeEntries(uint64_t rootId, const std::wstring& relative, ScanBudget* budget, bool validateText,
                        std::vector<Entry>* output) {
  HANDLE directory = INVALID_HANDLE_VALUE;
  AccessError result = openDirectory(rootId, relative, &directory);
  if (result != AccessError::kOk) return result;
  std::vector<Entry> candidates;
  result = enumerateDirectory(directory, budget, &candidates);
  CloseHandle(directory);
  if (result != AccessError::kOk) return result;
  for (const Entry& candidate : candidates) {
    const std::wstring child = relative.empty() ? candidate.name : relative + L"/" + candidate.name;
    HANDLE handle = INVALID_HANDLE_VALUE;
    result = candidate.directory ? openDirectory(rootId, child, &handle) : openFile(rootId, child, &handle);
    if (result == AccessError::kOk) {
      uint64_t byteLength = candidate.byteLength;
      if (!candidate.directory && validateText) {
        std::string ignoredContents;
        result = readOpenedFile(handle, budget, &ignoredContents);
        byteLength = ignoredContents.size();
      }
      CloseHandle(handle);
      if (result == AccessError::kOk) output->push_back({candidate.name, candidate.directory, byteLength});
    }
    if (result == AccessError::kScanLimit) return result;
    // Unsafe, reparse, deleted, or alias entries are intentionally absent from list/index output.
  }
  return AccessError::kOk;
}

AccessError collectSnapshots(uint64_t rootId, const std::wstring& relative, size_t depth, ScanBudget* budget,
                             bool validateText, std::vector<Snapshot>* output, bool* truncated) {
  if (depth > kMaxDepth) { *truncated = true; return AccessError::kScanLimit; }
  std::vector<Entry> entries;
  AccessError result = safeEntries(rootId, relative, budget, validateText, &entries);
  if (result != AccessError::kOk) return result;
  for (const Entry& entry : entries) {
    if (output->size() >= kMaxIndexEntries) { *truncated = true; return AccessError::kScanLimit; }
    const std::wstring child = relative.empty() ? entry.name : relative + L"/" + entry.name;
    if (entry.directory) {
      result = collectSnapshots(rootId, child, depth + 1, budget, validateText, output, truncated);
      if (result != AccessError::kOk) return result;
    } else {
      output->push_back({child, entry.byteLength});
    }
  }
  return AccessError::kOk;
}
#endif

napi_value makeString(napi_env env, const char* value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value adapterInfo(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "adapterId", makeString(env, "novel_studio_engineering_file_access"));
  napi_set_named_property(env, result, "target", makeString(env,
#ifdef _WIN32
      "win32-x64"
#else
      "unsupported"
#endif
  ));
  napi_set_named_property(env, result, "batch", makeString(env, "6"));
  napi_set_named_property(env, result, "accessEligible", makeString(env, "available"));
  napi_set_named_property(env, result, "mutation", makeString(env, "unavailable"));
  napi_set_named_property(env, result, "recovery", makeString(env, "unavailable"));
  return result;
}

napi_value openWorkspaceRoot(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) {
    throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
  }
  std::wstring wide;
  if (!readUtf16String(env, argv[0], kMaxRootUtf16Units, &wide) || !isSafeRootPath(wide)) {
    throwAccessError(env, AccessError::kUnsafePath); return nullptr;
  }
  HANDLE handle = CreateFileW(wide.c_str(), FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) { throwAccessError(env, AccessError::kNotFound); return nullptr; }
  const AccessError checked = verifyDirectory(handle);
  if (checked != AccessError::kOk) { CloseHandle(handle); throwAccessError(env, checked); return nullptr; }
  const uint64_t rootId = g_nextRoot.fetch_add(1);
  {
    std::scoped_lock lock(g_rootsMutex);
    BY_HANDLE_FILE_INFORMATION identity{};
    if (!GetFileInformationByHandle(handle, &identity)) { CloseHandle(handle); throwAccessError(env, AccessError::kIo); return nullptr; }
    try {
      g_roots.emplace(rootId, RootSession{handle, wide, identity});
    } catch (...) {
      CloseHandle(handle);
      throw;
    }
  }
  napi_value result, id;
  napi_create_object(env, &result);
  napi_create_bigint_uint64(env, rootId, &id);
  napi_set_named_property(env, result, "rootId", id);
  napi_set_named_property(env, result, "capability", makeString(env, "available"));
  return result;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value closeWorkspaceRoot(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 1; napi_value argv[1]; bool lossless = false; uint64_t rootId = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
    throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
  }
  HANDLE handle = INVALID_HANDLE_VALUE;
  { std::scoped_lock lock(g_rootsMutex); const auto found = g_roots.find(rootId); if (found != g_roots.end()) { handle = found->second.handle; g_roots.erase(found); } }
  napi_value result; napi_get_boolean(env, handle != INVALID_HANDLE_VALUE, &result);
  if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
  return result;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value readFile(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 2; napi_value argv[2]; bool lossless = false; uint64_t rootId = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
      napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
    throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
  }
  std::wstring path; if (!readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &path)) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  HANDLE handle = INVALID_HANDLE_VALUE; AccessError result = openFile(rootId, path, &handle); std::string output;
  if (result == AccessError::kOk) { result = readOpenedFile(handle, nullptr, &output); CloseHandle(handle); }
  if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
  if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
  napi_value buffer; napi_create_buffer_copy(env, output.size(), output.empty() ? nullptr : output.data(), nullptr, &buffer); return buffer;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value listDirectory(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 2; napi_value argv[2]; bool lossless = false; uint64_t rootId = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1 || argc > 2 ||
      napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  std::wstring path;
  if (argc == 2 && !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &path)) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  ScanBudget budget; std::vector<Entry> entries; AccessError result = safeEntries(rootId, path, &budget, true, &entries);
  if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
  if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
  napi_value output; napi_create_array_with_length(env, entries.size(), &output);
  for (size_t index = 0; index < entries.size(); ++index) {
    napi_value item, size; napi_create_object(env, &item); napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(entries[index].name.data()), entries[index].name.size(), &size);
    napi_set_named_property(env, item, "name", size); napi_get_boolean(env, entries[index].directory, &size); napi_set_named_property(env, item, "directory", size);
    napi_create_bigint_uint64(env, entries[index].byteLength, &size); napi_set_named_property(env, item, "byteLength", size); napi_set_element(env, output, index, item);
  }
  return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value buildIndex(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 1; napi_value argv[1]; bool lossless = false; uint64_t rootId = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  ScanBudget budget; std::vector<Snapshot> snapshots; bool truncated = false; AccessError result = collectSnapshots(rootId, L"", 0, &budget, true, &snapshots, &truncated);
  if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
  if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
  napi_value output, files, value; napi_create_object(env, &output); napi_create_array_with_length(env, snapshots.size(), &files);
  for (size_t index = 0; index < snapshots.size(); ++index) { napi_value item; napi_create_object(env, &item); napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(snapshots[index].relativePath.data()), snapshots[index].relativePath.size(), &value); napi_set_named_property(env, item, "relativePath", value); napi_create_bigint_uint64(env, snapshots[index].byteLength, &value); napi_set_named_property(env, item, "byteLength", value); napi_set_element(env, files, index, item); }
  napi_set_named_property(env, output, "files", files); napi_get_boolean(env, truncated, &value); napi_set_named_property(env, output, "truncated", value); return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value searchText(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
  size_t argc = 2; napi_value argv[2]; bool lossless = false; uint64_t rootId = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
      napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  std::wstring wideQuery; std::string query;
  if (!readUtf16String(env, argv[1], kMaxQueryUtf16Units, &wideQuery) || !wideToUtf8(wideQuery, &query) || query.empty() || query.size() > kMaxSearchQueryUtf8Bytes || query.find('\0') != std::string::npos) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
  ScanBudget budget; std::vector<Snapshot> snapshots; bool truncated = false; AccessError result = collectSnapshots(rootId, L"", 0, &budget, false, &snapshots, &truncated);
  if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
  napi_value output, matches, value; napi_create_object(env, &output); napi_create_array(env, &matches); uint32_t matchIndex = 0;
  for (const Snapshot& snapshot : snapshots) {
    HANDLE handle = INVALID_HANDLE_VALUE; std::string bytes; result = openFile(rootId, snapshot.relativePath, &handle);
    if (result == AccessError::kOk) { result = readOpenedFile(handle, &budget, &bytes); CloseHandle(handle); }
    if (result == AccessError::kNotText || result == AccessError::kTooLarge || result == AccessError::kNotFound || result == AccessError::kUnsafeObject || result == AccessError::kUnsafePath) continue;
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    for (size_t offset = bytes.find(query); offset != std::string::npos; offset = bytes.find(query, offset + 1)) {
      if (matchIndex >= kMaxSearchResults) { result = AccessError::kScanLimit; break; }
      napi_value item; napi_create_object(env, &item); napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(snapshot.relativePath.data()), snapshot.relativePath.size(), &value); napi_set_named_property(env, item, "relativePath", value); napi_create_bigint_uint64(env, offset, &value); napi_set_named_property(env, item, "byteOffset", value); napi_set_element(env, matches, matchIndex++, item);
    }
    if (result == AccessError::kScanLimit) break;
  }
  if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
  if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
  napi_set_named_property(env, output, "matches", matches); napi_get_boolean(env, truncated, &value); napi_set_named_property(env, output, "truncated", value); return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit); return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"adapterInfo", nullptr, adapterInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openWorkspaceRoot", nullptr, openWorkspaceRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeWorkspaceRoot", nullptr, closeWorkspaceRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"listDirectory", nullptr, listDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readFile", nullptr, readFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"searchText", nullptr, searchText, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"buildIndex", nullptr, buildIndex, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
#ifdef _WIN32
  napi_add_env_cleanup_hook(env, [](void*) { closeRoots(); }, nullptr);
#endif
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
