#include <node_api.h>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#include <winternl.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <cstring>
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
#if (defined(ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED) + \
     defined(ENGINEERING_CANARY_NO_FOLLOW_DISABLED) + \
     defined(ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED) + \
     defined(ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED) + \
     defined(ENGINEERING_CANARY_DURABILITY_DISABLED) + \
     defined(ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED)) > 1
#error "disabled-protection canary builds must weaken exactly one protection"
#endif
#if defined(ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED) || \
    defined(ENGINEERING_CANARY_NO_FOLLOW_DISABLED) || \
    defined(ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED) || \
    defined(ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED) || \
    defined(ENGINEERING_CANARY_DURABILITY_DISABLED) || \
    defined(ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED)
#define ENGINEERING_DISABLED_PROTECTION_CANARY_BUILD 1
#endif
#if defined(ENGINEERING_MUTATION_FAULT_INJECTION_BUILD) && \
    defined(ENGINEERING_DISABLED_PROTECTION_CANARY_BUILD)
#error "mutation fault injection must not weaken a disabled-protection canary"
#endif

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
constexpr ULONG kFileCreate = 2;
constexpr ULONG kFileOpenIf = 3;
constexpr ULONG kFileDirectoryFile = 0x00000001;
constexpr ULONG kFileSynchronousIoNonAlert = 0x00000020;
constexpr ULONG kFileNonDirectoryFile = 0x00000040;
constexpr ULONG kFileOpenReparsePoint = 0x00200000;
constexpr NTSTATUS kStatusObjectNameNotFound = static_cast<NTSTATUS>(0xC0000034L);
constexpr NTSTATUS kStatusObjectNameCollision = static_cast<NTSTATUS>(0xC0000035L);
constexpr ULONG kFileRenameInformation = 10;
// FILE_LINK_INFO / FileLinkInfo are not exposed by every supported Windows SDK.  The native
// FileLinkInformation ABI is stable and is invoked through ntdll below to keep this addon
// buildable against the SDK supplied by the Windows CI image.
constexpr ULONG kFileLinkInformation = 11;
constexpr size_t kMaxOpaqueIdentifierUtf8Bytes = 128;
constexpr size_t kMaxStagingIdUtf8Bytes = 96;

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

struct NativeFileLinkInformation {
  BOOLEAN replaceIfExists;
  HANDLE rootDirectory;
  ULONG fileNameLength;
  WCHAR fileName[1];
};

static_assert(offsetof(NativeFileLinkInformation, replaceIfExists) == 0);
static_assert(offsetof(NativeFileLinkInformation, rootDirectory) == 8);
static_assert(offsetof(NativeFileLinkInformation, fileNameLength) == 16);
static_assert(offsetof(NativeFileLinkInformation, fileName) == 20);

struct NativeFileRenameInformation {
  BOOLEAN replaceIfExists;
  HANDLE rootDirectory;
  ULONG fileNameLength;
  WCHAR fileName[1];
};

static_assert(offsetof(NativeFileRenameInformation, replaceIfExists) == 0);
static_assert(offsetof(NativeFileRenameInformation, rootDirectory) == 8);
static_assert(offsetof(NativeFileRenameInformation, fileNameLength) == 16);
static_assert(offsetof(NativeFileRenameInformation, fileName) == 20);

using NtCreateFileFn = NTSTATUS(NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
                                          PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtQueryDirectoryFileFn = NTSTATUS(NTAPI *)(HANDLE, HANDLE, PIO_APC_ROUTINE, PVOID, PIO_STATUS_BLOCK,
                                                  PVOID, ULONG, ULONG, BOOLEAN, PUNICODE_STRING, BOOLEAN);
using NtSetInformationFileFn = NTSTATUS(NTAPI *)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);

struct RootSession {
  HANDLE handle;
  std::wstring path;
  BY_HANDLE_FILE_INFORMATION identity;
  std::string canonicalPathIdentityChecksum;
};

// App-owned state is deliberately distinct from a content-root session.  The only callers are
// Desktop Main durability adapters; no Provider-facing API accepts a state-root identifier.
struct StateRootSession {
  HANDLE handle;
};

struct StateFileSession {
  HANDLE handle;
  uint64_t stateRootId;
};

struct BlobManifest {
  uint64_t byteLength;
  std::string sha256;
  std::string encoding;
  std::string bom;
  std::string eol;
};

struct FileObservation {
  BY_HANDLE_FILE_INFORMATION identity;
  FILE_BASIC_INFO basicInfo;
  BlobManifest manifest;
};

struct AbsenceProof {
  uint64_t rootId;
  std::wstring parentRelativePath;
  std::wstring leafName;
  BY_HANDLE_FILE_INFORMATION parentIdentity;
};

struct MutationWalBinding {
  uint64_t rootId;
  std::string transactionId;
  std::string operationId;
  std::string stagingId;
  std::string bindingChecksum;
  bool stageCreated;
};

// These mirrors are intentionally private to the addon.  The public shape remains the
// repository-owned EngineeringFileMutationRequestV2 / EngineeringMutationReceiptV2 schema.
struct V2RawManifest {
  uint64_t byteLength;
  std::string sha256;
  std::string bom;
  std::string eol;
  std::string metadataChecksum;
  bool observedIdentity;
  std::string rootBindingId;
  std::string relativeIdentity;
  std::string fileIdentity;
};

struct V2BlobReference {
  std::string contentRootBindingId;
  std::string blobId;
  std::string sha256;
  uint64_t byteLength;
  std::string bom;
  std::string eol;
};

struct V2AbsenceProof {
  std::string rootBindingId;
  std::string relativeIdentity;
  std::string parentDirectoryIdentity;
  std::string observedAt;
  std::string absenceProofChecksum;
};

struct V2BeforeImage {
  bool present;
  V2RawManifest manifest;
  V2BlobReference blob;
  V2AbsenceProof absenceProof;
};

struct V2CandidateImage {
  V2RawManifest manifest;
  V2BlobReference blob;
};

struct V2MutationRequest {
  std::string operationKind;
  std::string contentRootBindingId;
  std::string transactionId;
  std::string operationId;
  std::string providerSemanticVersionSetChecksum;
  std::wstring relativePath;
  std::string relativeIdentity;
  V2BeforeImage before;
  V2CandidateImage candidate;
  std::string stagingObjectId;
};

class ScopedHandle {
 public:
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ~ScopedHandle() {
    if (handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_);
  }

  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;

  HANDLE get() const { return handle_; }
  bool close() {
    if (handle_ == INVALID_HANDLE_VALUE) return true;
    if (!CloseHandle(handle_)) return false;
    handle_ = INVALID_HANDLE_VALUE;
    return true;
  }
  HANDLE release() {
    const HANDLE released = handle_;
    handle_ = INVALID_HANDLE_VALUE;
    return released;
  }

 private:
  HANDLE handle_;
};

std::mutex g_rootsMutex;
std::unordered_map<uint64_t, RootSession> g_roots;
std::atomic<uint64_t> g_nextRoot{1};
std::mutex g_stateRootsMutex;
std::unordered_map<uint64_t, StateRootSession> g_stateRoots;
std::unordered_map<uint64_t, StateFileSession> g_stateFiles;
std::atomic<uint64_t> g_nextStateRoot{1};
std::atomic<uint64_t> g_nextStateFile{1};
std::mutex g_mutationMutex;
std::unordered_map<uint64_t, AbsenceProof> g_absenceProofs;
std::unordered_map<uint64_t, MutationWalBinding> g_mutationWalBindings;
std::atomic<uint64_t> g_nextAbsenceProof{1};
std::atomic<uint64_t> g_nextMutationWalBinding{1};
#ifdef ENGINEERING_CANARY_DURABILITY_DISABLED
std::atomic<uint64_t> g_bypassedDataFlushes{0};
std::atomic<uint64_t> g_bypassedDirectoryFlushes{0};
#endif

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
  kAlreadyExists,
  kInvalidProof,
  kPrecondition,
  kHardLink,
  kDurability,
  kRecoveryRequired,
  kStagingConflict,
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
    case AccessError::kAlreadyExists: return "ENGINEERING_MUTATION_TARGET_ALREADY_EXISTS";
    case AccessError::kInvalidProof: return "ENGINEERING_MUTATION_INVALID_PROOF";
    case AccessError::kPrecondition: return "ENGINEERING_MUTATION_PRECONDITION_FAILED";
    case AccessError::kHardLink: return "ENGINEERING_MUTATION_HARD_LINK_REJECTED";
    case AccessError::kDurability: return "ENGINEERING_MUTATION_DURABILITY_UNPROVEN";
    case AccessError::kRecoveryRequired: return "ENGINEERING_MUTATION_RECOVERY_REQUIRED";
    case AccessError::kStagingConflict: return "ENGINEERING_MUTATION_STAGING_CONFLICT";
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
  {
    std::scoped_lock stateLock(g_stateRootsMutex);
    for (const auto& [id, session] : g_stateFiles) {
      (void)id;
      if (session.handle != INVALID_HANDLE_VALUE) CloseHandle(session.handle);
    }
    g_stateFiles.clear();
    for (const auto& [id, session] : g_stateRoots) {
      (void)id;
      if (session.handle != INVALID_HANDLE_VALUE) CloseHandle(session.handle);
    }
    g_stateRoots.clear();
  }
  {
    std::scoped_lock mutationLock(g_mutationMutex);
    g_absenceProofs.clear();
    g_mutationWalBindings.clear();
  }
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

bool normalizeNfcBounded(const std::wstring& input, size_t maxUnits, std::wstring* output) {
  if (input.size() > maxUnits || maxUnits >= static_cast<size_t>((std::numeric_limits<int>::max)())) return false;
  std::vector<wchar_t> buffer(maxUnits + 1, L'\0');
  const int normalizedLength = NormalizeString(
      NormalizationC, input.data(), static_cast<int>(input.size()), buffer.data(),
      static_cast<int>(buffer.size()));
  if (normalizedLength <= 0 || normalizedLength > static_cast<int>(maxUnits)) return false;
  output->assign(buffer.data(), static_cast<size_t>(normalizedLength));
  return true;
}

bool sha256Hex(const std::string& input, std::string* output) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD objectLength = 0;
  DWORD hashLength = 0;
  DWORD received = 0;
  bool success = false;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0 ||
      BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
                        sizeof(objectLength), &received, 0) < 0 ||
      received != sizeof(objectLength) || objectLength == 0 ||
      BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashLength),
                        sizeof(hashLength), &received, 0) < 0 ||
      received != sizeof(hashLength) || hashLength != 32) {
    if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
    return false;
  }
  std::vector<UCHAR> object(objectLength);
  std::vector<UCHAR> digest(hashLength);
  if (BCryptCreateHash(algorithm, &hash, object.data(), static_cast<ULONG>(object.size()), nullptr, 0, 0) >= 0 &&
      BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(input.data())),
                     static_cast<ULONG>(input.size()), 0) >= 0 &&
      BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) >= 0) {
    static constexpr char kHex[] = "0123456789abcdef";
    output->clear();
    output->reserve(digest.size() * 2);
    for (const UCHAR byte : digest) {
      output->push_back(kHex[(byte >> 4) & 0x0f]);
      output->push_back(kHex[byte & 0x0f]);
    }
    success = true;
  }
  if (hash != nullptr) BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return success;
}

std::string fixedWidthHex(uint64_t value, size_t width) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string result(width, '0');
  for (size_t index = 0; index < width; ++index) {
    result[width - index - 1] = kHex[value & 0x0f];
    value >>= 4;
  }
  return result;
}

bool canonicalRootPathChecksum(HANDLE handle, std::string* output) {
  const DWORD required = GetFinalPathNameByHandleW(
      handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_GUID);
  if (required == 0 || required > static_cast<DWORD>(kMaxRootUtf16Units)) return false;
  std::vector<wchar_t> buffer(static_cast<size_t>(required) + 1, L'\0');
  const DWORD written = GetFinalPathNameByHandleW(
      handle, buffer.data(), static_cast<DWORD>(buffer.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_GUID);
  if (written == 0 || written >= static_cast<DWORD>(buffer.size())) return false;
  const std::wstring value(buffer.data(), written);
  std::wstring normalized;
  if (!normalizeNfcBounded(value, kMaxRootUtf16Units, &normalized)) return false;
  std::string utf8;
  return wideToUtf8(normalized, &utf8) && sha256Hex(utf8, output);
}

bool readUtf16String(napi_env env, napi_value value, size_t maxUnits, std::wstring* output) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok ||
      length > maxUnits || length > static_cast<size_t>((std::numeric_limits<int>::max)())) return false;
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
  // Same-directory staging is an internal mutation implementation detail.  It must never
  // become a normal ref/list/read target, including while a crash leaves it for recovery.
  if (lower.rfind(L".novel-studio-stage-", 0) == 0) return true;
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
#ifdef ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED
  if (name == L"..") return true;
#endif
  if (name.empty() || name.size() > 255 || name == L"." || name == L".." || name.back() == L'.' || name.back() == L' ' ||
      isReservedDeviceName(name)) return false;
  std::string utf8;
  if (!wideToUtf8(name, &utf8) || utf8.empty() || utf8.size() > 255) return false;
  std::wstring normalized;
  if (!normalizeNfcBounded(name, 255, &normalized) || normalized != name) return false;
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

bool hasExpectedLeafName(HANDLE handle, const std::wstring& expected) {
#ifdef ENGINEERING_CANARY_NO_FOLLOW_DISABLED
  (void)handle;
  (void)expected;
  return true;
#else
#ifdef ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED
  if (expected == L"..") return true;
#endif
  return hasExactLeafName(handle, expected);
#endif
}

ULONG noFollowOpenOption() {
#ifdef ENGINEERING_CANARY_NO_FOLLOW_DISABLED
  return 0;
#else
  return kFileOpenReparsePoint;
#endif
}

bool hasUnsafeDirectoryAttributes(DWORD attributes) {
#ifdef ENGINEERING_CANARY_NO_FOLLOW_DISABLED
  (void)attributes;
  return false;
#else
  return (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE)) != 0;
#endif
}

bool hasUnsafeFileAttributes(DWORD attributes) {
#ifdef ENGINEERING_CANARY_NO_FOLLOW_DISABLED
  (void)attributes;
  return false;
#else
  return (attributes &
          (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_SPARSE_FILE)) != 0;
#endif
}

AccessError verifyDirectory(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!fileAttributes(handle, &attributes, &standard, &identity)) return AccessError::kIo;
  if (!standard.Directory || hasUnsafeDirectoryAttributes(attributes.FileAttributes) ||
      GetFileType(handle) != FILE_TYPE_DISK) return AccessError::kUnsafeObject;
  return AccessError::kOk;
}

AccessError verifyRegularFile(HANDLE handle, uint64_t* size) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!fileAttributes(handle, &attributes, &standard, &identity)) return AccessError::kIo;
  if (standard.Directory || hasUnsafeFileAttributes(attributes.FileAttributes) ||
      identity.nNumberOfLinks != 1 || GetFileType(handle) != FILE_TYPE_DISK || standard.EndOfFile.QuadPart < 0)
    return AccessError::kUnsafeObject;
  *size = static_cast<uint64_t>(standard.EndOfFile.QuadPart);
  return *size > kMaxFileBytes ? AccessError::kTooLarge : AccessError::kOk;
}

NtSetInformationFileFn ntSetInformationFile() {
#pragma warning(suppress : 4191)
  static const auto fn = reinterpret_cast<NtSetInformationFileFn>(
      GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationFile"));
  return fn;
}

// State files use a temporary-file hard link for create-only installation.  A link count above
// one is therefore expected during the short install/cleanup window; no-follow and regular-file
// checks remain mandatory.
AccessError verifyStateRegularFile(HANDLE handle, uint64_t* size) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  FILE_STANDARD_INFO standard{};
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!fileAttributes(handle, &attributes, &standard, &identity)) return AccessError::kIo;
  if (standard.Directory ||
      (attributes.FileAttributes &
       (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_SPARSE_FILE)) != 0 ||
      GetFileType(handle) != FILE_TYPE_DISK || standard.EndOfFile.QuadPart < 0) {
    return AccessError::kUnsafeObject;
  }
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
  ScopedHandle currentRootHandle(currentRoot);
  if (currentRootHandle.get() == INVALID_HANDLE_VALUE) return AccessError::kRootChanged;
  BY_HANDLE_FILE_INFORMATION currentIdentity{};
  std::string currentCanonicalPathIdentityChecksum;
  const AccessError currentChecked = verifyDirectory(currentRootHandle.get());
  const bool sameRoot = currentChecked == AccessError::kOk &&
      GetFileInformationByHandle(currentRootHandle.get(), &currentIdentity) != FALSE &&
      currentIdentity.dwVolumeSerialNumber == found->second.identity.dwVolumeSerialNumber &&
      currentIdentity.nFileIndexHigh == found->second.identity.nFileIndexHigh &&
      currentIdentity.nFileIndexLow == found->second.identity.nFileIndexLow &&
      canonicalRootPathChecksum(currentRootHandle.get(), &currentCanonicalPathIdentityChecksum) &&
      currentCanonicalPathIdentityChecksum == found->second.canonicalPathIdentityChecksum;
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
        kFileOpen, expectedDirectory ? (kFileDirectoryFile | kFileSynchronousIoNonAlert | noFollowOpenOption())
                                     : (kFileNonDirectoryFile | kFileSynchronousIoNonAlert | noFollowOpenOption()),
        nullptr, 0);
    if (ownsCurrent) CloseHandle(current);
    if (!isSuccess(status) || next == INVALID_HANDLE_VALUE) return status == static_cast<NTSTATUS>(0xC0000034L) ? AccessError::kNotFound : AccessError::kUnsafeObject;
    current = next;
    ownsCurrent = true;
    uint64_t ignoredSize = 0;
    const AccessError checked = expectedDirectory ? verifyDirectory(current) : verifyRegularFile(current, &ignoredSize);
    // Do not permit a case-folded or short-name alias to become a canonical ref.
    if (checked != AccessError::kOk || !hasExpectedLeafName(current, segments[index])) {
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

// State paths are generated by Main from its fixed state root. They retain all leaf/Unicode and
// no-follow checks, but must allow the app's own engineering-v2 namespace that content roots
// intentionally hard-deny.
bool parseStateRelativePath(const std::wstring& relative, bool allowEmpty,
                            std::vector<std::wstring>* segments) {
  segments->clear();
  if (relative.empty()) return allowEmpty;
  std::string utf8;
  if (relative.size() > kMaxRelativeUtf16Units || !wideToUtf8(relative, &utf8) ||
      utf8.size() > kMaxPathUtf8Bytes || relative.front() == L'/' ||
      relative.find(L'\\') != std::wstring::npos || relative.find(L':') != std::wstring::npos) {
    return false;
  }
  size_t start = 0;
  while (start < relative.size()) {
    const size_t end = relative.find(L'/', start);
    const std::wstring segment = relative.substr(start, end == std::wstring::npos ? end : end - start);
    if (!isCanonicalLeafName(segment) || segments->size() >= kMaxSegments) return false;
    segments->push_back(segment);
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return !segments->empty();
}

AccessError duplicateStateRoot(uint64_t stateRootId, HANDLE* output) {
  std::scoped_lock lock(g_stateRootsMutex);
  const auto found = g_stateRoots.find(stateRootId);
  if (found == g_stateRoots.end()) return AccessError::kRootUnavailable;
  HANDLE duplicate = INVALID_HANDLE_VALUE;
  if (!DuplicateHandle(GetCurrentProcess(), found->second.handle, GetCurrentProcess(), &duplicate, 0, FALSE,
                       DUPLICATE_SAME_ACCESS)) return AccessError::kIo;
  const AccessError checked = verifyDirectory(duplicate);
  if (checked != AccessError::kOk) {
    CloseHandle(duplicate);
    return checked;
  }
  *output = duplicate;
  return AccessError::kOk;
}

AccessError openStateRelative(HANDLE root, const std::vector<std::wstring>& segments, bool directory,
                              ACCESS_MASK finalAccess, ULONG disposition, HANDLE* output) {
  HANDLE current = root;
  bool ownsCurrent = false;
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) return AccessError::kUnavailable;
  for (size_t index = 0; index < segments.size(); ++index) {
    const bool expectedDirectory = index + 1 < segments.size() || directory;
    UNICODE_STRING name{};
    name.Buffer = const_cast<PWSTR>(segments[index].data());
    name.Length = static_cast<USHORT>(segments[index].size() * sizeof(wchar_t));
    name.MaximumLength = name.Length;
    OBJECT_ATTRIBUTES attributes{};
    InitializeObjectAttributes(&attributes, &name, OBJ_CASE_INSENSITIVE, current, nullptr);
    IO_STATUS_BLOCK statusBlock{};
    HANDLE next = INVALID_HANDLE_VALUE;
    const ACCESS_MASK access = index + 1 == segments.size()
        ? finalAccess
        : FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
              FILE_ADD_SUBDIRECTORY | SYNCHRONIZE;
    const NTSTATUS status = create(
        &next, access, &attributes, &statusBlock, nullptr, 0,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        index + 1 == segments.size() ? disposition : kFileOpen,
        expectedDirectory ? (kFileDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint)
                          : (kFileNonDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint),
        nullptr, 0);
    if (ownsCurrent) CloseHandle(current);
    if (!isSuccess(status) || next == INVALID_HANDLE_VALUE) {
      return status == kStatusObjectNameNotFound ? AccessError::kNotFound
           : status == kStatusObjectNameCollision ? AccessError::kAlreadyExists
           : AccessError::kUnsafeObject;
    }
    current = next;
    ownsCurrent = true;
    uint64_t ignoredSize = 0;
    const AccessError checked = expectedDirectory ? verifyDirectory(current) : verifyStateRegularFile(current, &ignoredSize);
    if (checked != AccessError::kOk || !hasExactLeafName(current, segments[index])) {
      CloseHandle(current);
      return checked == AccessError::kOk ? AccessError::kUnsafePath : checked;
    }
  }
  *output = current;
  return AccessError::kOk;
}

AccessError openStateDirectory(uint64_t stateRootId, const std::wstring& relative, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseStateRelativePath(relative, true, &segments)) return AccessError::kUnsafePath;
  HANDLE root = INVALID_HANDLE_VALUE;
  AccessError result = duplicateStateRoot(stateRootId, &root);
  if (result != AccessError::kOk) return result;
  if (segments.empty()) {
    *output = root;
    return AccessError::kOk;
  }
  result = openStateRelative(root, segments, true,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
          FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD | SYNCHRONIZE,
      kFileOpen, output);
  CloseHandle(root);
  return result;
}

AccessError ensureStateDirectory(uint64_t stateRootId, const std::wstring& relative) {
  std::vector<std::wstring> segments;
  if (!parseStateRelativePath(relative, true, &segments)) return AccessError::kUnsafePath;
  HANDLE root = INVALID_HANDLE_VALUE;
  AccessError result = duplicateStateRoot(stateRootId, &root);
  if (result != AccessError::kOk) return result;
  if (segments.empty()) {
    CloseHandle(root);
    return AccessError::kOk;
  }
  HANDLE created = INVALID_HANDLE_VALUE;
  result = openStateRelative(root, segments, true,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
          FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD | SYNCHRONIZE,
      kFileOpenIf, &created);
  CloseHandle(root);
  if (created != INVALID_HANDLE_VALUE) CloseHandle(created);
  return result;
}

AccessError openStateFile(uint64_t stateRootId, const std::wstring& relative, ACCESS_MASK access,
                          ULONG disposition, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseStateRelativePath(relative, false, &segments)) return AccessError::kUnsafePath;
  HANDLE root = INVALID_HANDLE_VALUE;
  AccessError result = duplicateStateRoot(stateRootId, &root);
  if (result != AccessError::kOk) return result;
  result = openStateRelative(root, segments, false, access, disposition, output);
  CloseHandle(root);
  return result;
}

AccessError readStateFile(HANDLE handle, std::string* bytes) {
  uint64_t size = 0;
  const AccessError checked = verifyStateRegularFile(handle, &size);
  if (checked != AccessError::kOk) return checked;
  if (size > kMaxFileBytes || size > static_cast<uint64_t>((std::numeric_limits<DWORD>::max)())) return AccessError::kTooLarge;
  LARGE_INTEGER start{};
  if (!SetFilePointerEx(handle, start, nullptr, FILE_BEGIN)) return AccessError::kIo;
  bytes->assign(static_cast<size_t>(size), '\0');
  size_t offset = 0;
  while (offset < bytes->size()) {
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(64 * 1024, bytes->size() - offset));
    DWORD read = 0;
    if (!ReadFile(handle, bytes->data() + offset, requested, &read, nullptr) || read == 0) return AccessError::kIo;
    offset += read;
  }
  return AccessError::kOk;
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

bool sameObjectKey(const BY_HANDLE_FILE_INFORMATION& left, const BY_HANDLE_FILE_INFORMATION& right) {
  return left.dwVolumeSerialNumber == right.dwVolumeSerialNumber &&
      left.nFileIndexHigh == right.nFileIndexHigh && left.nFileIndexLow == right.nFileIndexLow;
}

bool isSafeOpaqueIdentifier(const std::string& value, size_t maximumLength) {
  if (value.empty() || value.size() > maximumLength) return false;
  for (const unsigned char character : value) {
    if (!((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') || character == '-' || character == '_' ||
          character == '.')) {
      return false;
    }
  }
  return true;
}

bool readOpaqueIdentifier(napi_env env, napi_value value, size_t maximumLength, std::string* output) {
  std::wstring wide;
  if (!readUtf16String(env, value, maximumLength, &wide) || !wideToUtf8(wide, output)) return false;
  return isSafeOpaqueIdentifier(*output, maximumLength);
}

std::string detectBom(const std::string& bytes) {
  return bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xef &&
          static_cast<unsigned char>(bytes[1]) == 0xbb && static_cast<unsigned char>(bytes[2]) == 0xbf
      ? "utf8"
      : "none";
}

std::string detectEol(const std::string& bytes) {
  bool sawLf = false;
  bool sawCrLf = false;
  bool sawBareCr = false;
  for (size_t index = 0; index < bytes.size(); ++index) {
    if (bytes[index] == '\r') {
      if (index + 1 < bytes.size() && bytes[index + 1] == '\n') {
        sawCrLf = true;
        ++index;
      } else {
        sawBareCr = true;
      }
    } else if (bytes[index] == '\n') {
      sawLf = true;
    }
  }
  if (!sawLf && !sawCrLf && !sawBareCr) return "none";
  if (sawCrLf && !sawLf && !sawBareCr) return "crlf";
  if (sawLf && !sawCrLf && !sawBareCr) return "lf";
  return "mixed";
}

bool manifestForBytes(const std::string& bytes, BlobManifest* output) {
  if (bytes.size() > kMaxFileBytes || !isUtf8Text(bytes)) return false;
  output->byteLength = static_cast<uint64_t>(bytes.size());
  output->encoding = "utf8";
  output->bom = detectBom(bytes);
  output->eol = detectEol(bytes);
  return sha256Hex(bytes, &output->sha256);
}

bool hasNamedProperty(napi_env env, napi_value object, const char* name) {
  bool has = false;
  return napi_has_named_property(env, object, name, &has) == napi_ok && has;
}

bool readStringProperty(napi_env env, napi_value object, const char* name, size_t maximumLength,
                        std::string* output) {
  napi_value value;
  std::wstring wide;
  return hasNamedProperty(env, object, name) && napi_get_named_property(env, object, name, &value) == napi_ok &&
      readUtf16String(env, value, maximumLength, &wide) && wideToUtf8(wide, output);
}

bool readBigintProperty(napi_env env, napi_value object, const char* name, uint64_t* output) {
  napi_value value;
  bool lossless = false;
  return hasNamedProperty(env, object, name) && napi_get_named_property(env, object, name, &value) == napi_ok &&
      napi_get_value_bigint_uint64(env, value, output, &lossless) == napi_ok && lossless;
}

bool readBlobManifest(napi_env env, napi_value value, BlobManifest* output) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object ||
      !readBigintProperty(env, value, "byteLength", &output->byteLength) ||
      !readStringProperty(env, value, "sha256", 64, &output->sha256) ||
      !readStringProperty(env, value, "encoding", 16, &output->encoding) ||
      !readStringProperty(env, value, "bom", 16, &output->bom) ||
      !readStringProperty(env, value, "eol", 16, &output->eol)) {
    return false;
  }
  return output->encoding == "utf8" && (output->bom == "none" || output->bom == "utf8") &&
      (output->eol == "none" || output->eol == "lf" || output->eol == "crlf" || output->eol == "mixed") &&
      output->sha256.size() == 64 &&
      std::all_of(output->sha256.begin(), output->sha256.end(), [](unsigned char character) {
        return (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f');
      });
}

bool sameManifest(const BlobManifest& left, const BlobManifest& right) {
  return left.byteLength == right.byteLength &&
#ifndef ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED
      left.sha256 == right.sha256 &&
#endif
      left.encoding == right.encoding && left.bom == right.bom && left.eol == right.eol;
}

bool readImmutableBlob(napi_env env, napi_value bufferValue, napi_value manifestValue, std::string* bytes,
                       BlobManifest* manifest) {
  bool isBuffer = false;
  void* buffer = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, bufferValue, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, bufferValue, &buffer, &length) != napi_ok || length > kMaxFileBytes ||
      !readBlobManifest(env, manifestValue, manifest)) {
    return false;
  }
  if (length == 0) {
    bytes->clear();
  } else if (buffer == nullptr) {
    return false;
  } else {
    bytes->assign(static_cast<const char*>(buffer), length);
  }
  BlobManifest observed{};
  return manifestForBytes(*bytes, &observed) && sameManifest(*manifest, observed);
}

bool makeFileIdentity(napi_env env, const BY_HANDLE_FILE_INFORMATION& identity, napi_value* output) {
  const uint64_t fileIndex =
      (static_cast<uint64_t>(identity.nFileIndexHigh) << 32) | identity.nFileIndexLow;
  napi_value volume;
  napi_value file;
  return napi_create_object(env, output) == napi_ok &&
      napi_create_string_utf8(env, fixedWidthHex(identity.dwVolumeSerialNumber, 8).c_str(), NAPI_AUTO_LENGTH,
                              &volume) == napi_ok &&
      napi_create_string_utf8(env, fixedWidthHex(fileIndex, 16).c_str(), NAPI_AUTO_LENGTH, &file) == napi_ok &&
      napi_set_named_property(env, *output, "volumeIdentity", volume) == napi_ok &&
      napi_set_named_property(env, *output, "fileIdentity", file) == napi_ok;
}

bool makeBlobManifest(napi_env env, const BlobManifest& manifest, napi_value* output) {
  napi_value byteLength;
  napi_value sha256;
  napi_value encoding;
  napi_value bom;
  napi_value eol;
  return napi_create_object(env, output) == napi_ok &&
      napi_create_bigint_uint64(env, manifest.byteLength, &byteLength) == napi_ok &&
      napi_create_string_utf8(env, manifest.sha256.c_str(), NAPI_AUTO_LENGTH, &sha256) == napi_ok &&
      napi_create_string_utf8(env, manifest.encoding.c_str(), NAPI_AUTO_LENGTH, &encoding) == napi_ok &&
      napi_create_string_utf8(env, manifest.bom.c_str(), NAPI_AUTO_LENGTH, &bom) == napi_ok &&
      napi_create_string_utf8(env, manifest.eol.c_str(), NAPI_AUTO_LENGTH, &eol) == napi_ok &&
      napi_set_named_property(env, *output, "byteLength", byteLength) == napi_ok &&
      napi_set_named_property(env, *output, "sha256", sha256) == napi_ok &&
      napi_set_named_property(env, *output, "encoding", encoding) == napi_ok &&
      napi_set_named_property(env, *output, "bom", bom) == napi_ok &&
      napi_set_named_property(env, *output, "eol", eol) == napi_ok;
}

AccessError rootSessionSnapshot(uint64_t rootId, RootSession* output) {
  std::scoped_lock lock(g_rootsMutex);
  const auto found = g_roots.find(rootId);
  if (found == g_roots.end()) return AccessError::kRootUnavailable;
  output->handle = INVALID_HANDLE_VALUE;
  output->path = found->second.path;
  output->identity = found->second.identity;
  output->canonicalPathIdentityChecksum = found->second.canonicalPathIdentityChecksum;
  return AccessError::kOk;
}

AccessError openMutationRootWithShare(uint64_t rootId, DWORD shareMode, HANDLE* output) {
  RootSession session{};
  const AccessError snapshot = rootSessionSnapshot(rootId, &session);
  if (snapshot != AccessError::kOk) return snapshot;
  const DWORD desiredAccess = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES |
      FILE_WRITE_ATTRIBUTES | FILE_ADD_FILE | FILE_DELETE_CHILD | SYNCHRONIZE;
  ScopedHandle handle(CreateFileW(session.path.c_str(), desiredAccess, shareMode, nullptr, OPEN_EXISTING,
                                  FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (handle.get() == INVALID_HANDLE_VALUE) return AccessError::kRootChanged;
  BY_HANDLE_FILE_INFORMATION identity{};
  std::string canonicalPathIdentityChecksum;
  if (verifyDirectory(handle.get()) != AccessError::kOk ||
      !GetFileInformationByHandle(handle.get(), &identity) || !sameObjectKey(identity, session.identity) ||
      !canonicalRootPathChecksum(handle.get(), &canonicalPathIdentityChecksum) ||
      canonicalPathIdentityChecksum != session.canonicalPathIdentityChecksum) {
    return AccessError::kRootChanged;
  }
  *output = handle.release();
  return AccessError::kOk;
}

AccessError openMutationRelative(uint64_t rootId, const std::vector<std::wstring>& segments, bool directory,
                                  DWORD finalDesiredAccess, HANDLE* output,
                                  DWORD finalShareMode = FILE_SHARE_READ) {
  HANDLE current = INVALID_HANDLE_VALUE;
  AccessError result = openMutationRootWithShare(
      rootId, segments.empty() ? finalShareMode : FILE_SHARE_READ, &current);
  if (result != AccessError::kOk) return result;
  if (segments.empty()) {
    if (!directory) {
      CloseHandle(current);
      return AccessError::kUnsafePath;
    }
    *output = current;
    return AccessError::kOk;
  }
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) {
    CloseHandle(current);
    return AccessError::kUnavailable;
  }
  for (size_t index = 0; index < segments.size(); ++index) {
    const bool expectedDirectory = index + 1 < segments.size() || directory;
    const DWORD desiredAccess = index + 1 == segments.size()
        ? finalDesiredAccess
        : FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
              FILE_ADD_FILE | FILE_DELETE_CHILD | SYNCHRONIZE;
    UNICODE_STRING name{};
    name.Buffer = const_cast<PWSTR>(segments[index].data());
    name.Length = static_cast<USHORT>(segments[index].size() * sizeof(wchar_t));
    name.MaximumLength = name.Length;
    OBJECT_ATTRIBUTES attributes{};
    InitializeObjectAttributes(&attributes, &name, OBJ_CASE_INSENSITIVE, current, nullptr);
    IO_STATUS_BLOCK statusBlock{};
    HANDLE next = INVALID_HANDLE_VALUE;
    const DWORD shareMode = index + 1 == segments.size() ? finalShareMode : FILE_SHARE_READ;
    const NTSTATUS status = create(
        &next, desiredAccess, &attributes, &statusBlock, nullptr, 0, shareMode, kFileOpen,
        expectedDirectory ? (kFileDirectoryFile | kFileSynchronousIoNonAlert | noFollowOpenOption())
                          : (kFileNonDirectoryFile | kFileSynchronousIoNonAlert | noFollowOpenOption()),
        nullptr, 0);
    CloseHandle(current);
    if (!isSuccess(status) || next == INVALID_HANDLE_VALUE) {
      return status == kStatusObjectNameNotFound ? AccessError::kNotFound : AccessError::kUnsafeObject;
    }
    current = next;
    uint64_t ignoredSize = 0;
    const AccessError checked = expectedDirectory ? verifyDirectory(current) : verifyRegularFile(current, &ignoredSize);
    if (checked != AccessError::kOk || !hasExpectedLeafName(current, segments[index])) {
      CloseHandle(current);
      return checked == AccessError::kOk ? AccessError::kUnsafePath : checked;
    }
  }
  *output = current;
  return AccessError::kOk;
}

AccessError openMutationDirectory(uint64_t rootId, const std::wstring& relative, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseRelativePath(relative, true, &segments)) return AccessError::kUnsafePath;
  return openMutationRelative(
      rootId, segments, true,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
          FILE_ADD_FILE | FILE_DELETE_CHILD | SYNCHRONIZE,
      output);
}

// The initial traversal is restrictive.  Once a same-directory stage exists, reopen only the
// final parent with delete sharing so a handle-relative create-only handoff can proceed; prove
// it is still the exact parent observed before staging before returning it to the caller.
AccessError openMutationHandoffDirectory(uint64_t rootId, const std::wstring& relative,
                                         const BY_HANDLE_FILE_INFORMATION& expectedIdentity, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseRelativePath(relative, true, &segments)) return AccessError::kUnsafePath;
  HANDLE parent = INVALID_HANDLE_VALUE;
  AccessError result = openMutationRelative(
      rootId, segments, true,
      FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES |
          FILE_ADD_FILE | FILE_DELETE_CHILD | SYNCHRONIZE,
      &parent, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
  if (result != AccessError::kOk) return result;
  BY_HANDLE_FILE_INFORMATION observedIdentity{};
  if (!GetFileInformationByHandle(parent, &observedIdentity) || !sameObjectKey(expectedIdentity, observedIdentity)) {
    CloseHandle(parent);
    return AccessError::kPrecondition;
  }
  *output = parent;
  return AccessError::kOk;
}

AccessError openMutationFile(uint64_t rootId, const std::wstring& relative, HANDLE* output) {
  std::vector<std::wstring> segments;
  if (!parseRelativePath(relative, false, &segments)) return AccessError::kUnsafePath;
  return openMutationRelative(rootId, segments, false, FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                              output);
}

AccessError checkRelativeLeafAbsent(HANDLE parent, const std::wstring& leaf) {
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) return AccessError::kUnavailable;
  UNICODE_STRING name{};
  name.Buffer = const_cast<PWSTR>(leaf.data());
  name.Length = static_cast<USHORT>(leaf.size() * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  OBJECT_ATTRIBUTES attributes{};
  InitializeObjectAttributes(&attributes, &name, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK statusBlock{};
  HANDLE existing = INVALID_HANDLE_VALUE;
  const NTSTATUS status = create(
      &existing, FILE_READ_ATTRIBUTES | SYNCHRONIZE, &attributes, &statusBlock, nullptr, 0, FILE_SHARE_READ,
      kFileOpen, kFileNonDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint, nullptr, 0);
  if (isSuccess(status) && existing != INVALID_HANDLE_VALUE) {
    CloseHandle(existing);
    return AccessError::kAlreadyExists;
  }
  return status == kStatusObjectNameNotFound ? AccessError::kOk : AccessError::kUnsafeObject;
}

AccessError openMutationLeafWithAccess(HANDLE parent, const std::wstring& leaf, ACCESS_MASK desiredAccess,
                                       HANDLE* output) {
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) return AccessError::kUnavailable;
  UNICODE_STRING name{};
  name.Buffer = const_cast<PWSTR>(leaf.data());
  name.Length = static_cast<USHORT>(leaf.size() * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  OBJECT_ATTRIBUTES attributes{};
  InitializeObjectAttributes(&attributes, &name, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK statusBlock{};
  HANDLE file = INVALID_HANDLE_VALUE;
  const NTSTATUS status = create(
      &file, desiredAccess, &attributes, &statusBlock, nullptr, 0,
      FILE_SHARE_READ | FILE_SHARE_DELETE, kFileOpen,
      kFileNonDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint, nullptr, 0);
  if (!isSuccess(status) || file == INVALID_HANDLE_VALUE) {
    return status == kStatusObjectNameNotFound ? AccessError::kNotFound : AccessError::kUnsafeObject;
  }
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!GetFileInformationByHandle(file, &identity)) {
    CloseHandle(file);
    return AccessError::kIo;
  }
  if (identity.nNumberOfLinks != 1) {
    CloseHandle(file);
    return AccessError::kHardLink;
  }
  uint64_t ignoredSize = 0;
  const AccessError checked = verifyRegularFile(file, &ignoredSize);
  if (checked != AccessError::kOk || !hasExactLeafName(file, leaf)) {
    CloseHandle(file);
    return checked == AccessError::kOk ? AccessError::kUnsafePath : checked;
  }
  *output = file;
  return AccessError::kOk;
}

AccessError openMutationLeaf(HANDLE parent, const std::wstring& leaf, HANDLE* output) {
  return openMutationLeafWithAccess(parent, leaf, FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, output);
}

// A replace handoff renames this exact handle, so it must have DELETE access.  The permissive
// delete share is intentional: a concurrent namespace change remains possible, but the later
// create-only handoff must then preserve that external replacement instead of overwriting it.
AccessError openMutationReplaceLeaf(HANDLE parent, const std::wstring& leaf, HANDLE* output) {
  return openMutationLeafWithAccess(parent, leaf,
                                    FILE_READ_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE, output);
}

std::wstring stagingLeafName(const std::string& stagingId) {
  std::wstring value = L".novel-studio-stage-";
  value.reserve(value.size() + stagingId.size());
  for (const unsigned char character : stagingId) value.push_back(static_cast<wchar_t>(character));
  return value;
}

// This name is derived before the original target is moved.  It intentionally stays in the
// existing staging namespace so a crash or a failed create-only candidate handoff is visible to
// the startup recovery scanner without adding another recovery host or storage format.
std::wstring recoveryStagingLeafName(const std::string& stagingId) {
  return stagingLeafName("before-" + stagingId);
}

AccessError createStagingFile(HANDLE parent, const std::string& stagingId, HANDLE* output) {
  const NtCreateFileFn create = ntCreateFile();
  if (create == nullptr) return AccessError::kUnavailable;
  const std::wstring leaf = stagingLeafName(stagingId);
  UNICODE_STRING name{};
  name.Buffer = const_cast<PWSTR>(leaf.data());
  name.Length = static_cast<USHORT>(leaf.size() * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  OBJECT_ATTRIBUTES attributes{};
  InitializeObjectAttributes(&attributes, &name, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK statusBlock{};
  HANDLE stage = INVALID_HANDLE_VALUE;
  // ShareAccess=0 pins this staged object and its parent/ancestors while the restrictive
  // traversal parent is exchanged for the short permissive handoff parent.
  const NTSTATUS status = create(
      &stage, FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | DELETE |
                  SYNCHRONIZE,
      &attributes, &statusBlock, nullptr, FILE_ATTRIBUTE_NORMAL, 0, kFileCreate,
      kFileNonDirectoryFile | kFileSynchronousIoNonAlert | kFileOpenReparsePoint, nullptr, 0);
  if (!isSuccess(status) || stage == INVALID_HANDLE_VALUE) {
    return status == kStatusObjectNameCollision ? AccessError::kStagingConflict : AccessError::kIo;
  }
  uint64_t ignoredSize = 0;
  const AccessError checked = verifyRegularFile(stage, &ignoredSize);
  if (checked != AccessError::kOk) {
    CloseHandle(stage);
    return checked;
  }
  *output = stage;
  return AccessError::kOk;
}

enum class DurableFlushKind { kData, kDirectory };

bool flushDurably(HANDLE handle, DurableFlushKind kind) {
#ifdef ENGINEERING_CANARY_DURABILITY_DISABLED
  (void)handle;
  if (kind == DurableFlushKind::kData) {
    g_bypassedDataFlushes.fetch_add(1);
  } else {
    g_bypassedDirectoryFlushes.fetch_add(1);
  }
  return true;
#else
  (void)kind;
  return FlushFileBuffers(handle) != FALSE;
#endif
}

AccessError writeAndFlush(HANDLE handle, const std::string& bytes) {
  size_t offset = 0;
  while (offset < bytes.size()) {
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(64 * 1024, bytes.size() - offset));
    DWORD written = 0;
    if (!WriteFile(handle, bytes.data() + offset, requested, &written, nullptr) || written != requested) {
      return AccessError::kIo;
    }
    offset += written;
  }
  return flushDurably(handle, DurableFlushKind::kData) ? AccessError::kOk : AccessError::kDurability;
}

AccessError applyQualifiedReplaceMetadata(HANDLE stage, const FILE_BASIC_INFO& sourceBasicInfo) {
  const DWORD attributes = sourceBasicInfo.FileAttributes;
  if (attributes != FILE_ATTRIBUTE_NORMAL && attributes != FILE_ATTRIBUTE_ARCHIVE) {
    return AccessError::kPrecondition;
  }
  return SetFileInformationByHandle(stage, FileBasicInfo, const_cast<FILE_BASIC_INFO*>(&sourceBasicInfo),
                                    sizeof(sourceBasicInfo))
      ? AccessError::kOk
      : AccessError::kPrecondition;
}

AccessError renameOpenedFile(HANDLE file, HANDLE parent, const std::wstring& leaf, bool replaceExisting) {
  const size_t byteLength = leaf.size() * sizeof(wchar_t);
  std::vector<unsigned char> storage(offsetof(FILE_RENAME_INFO, FileName) + byteLength, 0);
  auto* rename = reinterpret_cast<FILE_RENAME_INFO*>(storage.data());
  rename->ReplaceIfExists = replaceExisting ? TRUE : FALSE;
  rename->RootDirectory = parent;
  rename->FileNameLength = static_cast<DWORD>(byteLength);
  std::memcpy(rename->FileName, leaf.data(), byteLength);
  return SetFileInformationByHandle(file, FileRenameInfo, rename, static_cast<DWORD>(storage.size()))
      ? AccessError::kOk
      : AccessError::kRecoveryRequired;
}

// The mutation handoff never uses pathname overwrite.  If another process installs a leaf in
// either window, the handle-relative native rename fails and both the candidate stage and (if
// moved) original recovery stage remain visible to recovery.
AccessError renameOpenedFileCreateOnly(HANDLE file, HANDLE parent, const std::wstring& leaf) {
  const auto setInformation = ntSetInformationFile();
  if (setInformation == nullptr) return AccessError::kUnavailable;
  const size_t byteLength = leaf.size() * sizeof(wchar_t);
  std::vector<unsigned char> storage(offsetof(NativeFileRenameInformation, fileName) + byteLength, 0);
  auto* rename = reinterpret_cast<NativeFileRenameInformation*>(storage.data());
  rename->replaceIfExists = FALSE;
  rename->rootDirectory = parent;
  rename->fileNameLength = static_cast<ULONG>(byteLength);
  std::memcpy(rename->fileName, leaf.data(), byteLength);
  IO_STATUS_BLOCK statusBlock{};
  const NTSTATUS status = setInformation(file, &statusBlock, rename, static_cast<ULONG>(storage.size()),
                                         kFileRenameInformation);
  return isSuccess(status) ? AccessError::kOk : AccessError::kRecoveryRequired;
}

AccessError deleteRecoveryBeforeFile(HANDLE recovery, const std::wstring& expectedLeaf,
                                     const BY_HANDLE_FILE_INFORMATION& expectedIdentity) {
  BY_HANDLE_FILE_INFORMATION observedIdentity{};
  if (!GetFileInformationByHandle(recovery, &observedIdentity) ||
      !sameObjectKey(expectedIdentity, observedIdentity) || !hasExactLeafName(recovery, expectedLeaf)) {
    return AccessError::kRecoveryRequired;
  }
  FILE_DISPOSITION_INFO disposition{};
  disposition.DeleteFile = TRUE;
  return SetFileInformationByHandle(recovery, FileDispositionInfo, &disposition, sizeof(disposition))
      ? AccessError::kOk
      : AccessError::kRecoveryRequired;
}

AccessError observeOpenedFile(HANDLE handle, FileObservation* output, std::string* bytes) {
  AccessError result = readOpenedFile(handle, nullptr, bytes);
  if (result != AccessError::kOk) return result;
  if (!GetFileInformationByHandle(handle, &output->identity) ||
      !GetFileInformationByHandleEx(handle, FileBasicInfo, &output->basicInfo, sizeof(output->basicInfo)) ||
      !manifestForBytes(*bytes, &output->manifest)) {
    return AccessError::kIo;
  }
  return AccessError::kOk;
}

bool resetFilePointer(HANDLE handle) {
  LARGE_INTEGER zero{};
  return SetFilePointerEx(handle, zero, nullptr, FILE_BEGIN) != FALSE;
}

std::string mutationWalChecksum(uint64_t rootId, const std::string& transactionId,
                                const std::string& operationId, const std::string& stagingId) {
  std::string material = std::to_string(rootId);
  material += "\n" + transactionId + "\n" + operationId + "\n" + stagingId;
  std::string output;
  return sha256Hex(material, &output) ? output : std::string();
}

AccessError readMutationWalBinding(uint64_t rootId, uint64_t bindingId, const std::string& transactionId,
                                   const std::string& operationId, const std::string& stagingId,
                                   MutationWalBinding* output) {
  std::scoped_lock lock(g_mutationMutex);
  const auto found = g_mutationWalBindings.find(bindingId);
  if (found == g_mutationWalBindings.end() ||
#ifndef ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED
      found->second.rootId != rootId ||
#endif
      found->second.transactionId != transactionId || found->second.operationId != operationId ||
      found->second.stagingId != stagingId) {
    return AccessError::kInvalidProof;
  }
  *output = found->second;
  return AccessError::kOk;
}

void markMutationStageCreated(uint64_t bindingId) {
  std::scoped_lock lock(g_mutationMutex);
  const auto found = g_mutationWalBindings.find(bindingId);
  if (found != g_mutationWalBindings.end()) found->second.stageCreated = true;
}

void consumeMutationWalBinding(uint64_t bindingId) {
  std::scoped_lock lock(g_mutationMutex);
  g_mutationWalBindings.erase(bindingId);
}

AccessError takeAbsenceProof(uint64_t proofId, uint64_t rootId, const std::wstring& parentRelativePath,
                             const std::wstring& leafName, const BY_HANDLE_FILE_INFORMATION& parentIdentity) {
  std::scoped_lock lock(g_mutationMutex);
  const auto found = g_absenceProofs.find(proofId);
  if (found == g_absenceProofs.end() || found->second.rootId != rootId ||
      found->second.parentRelativePath != parentRelativePath || found->second.leafName != leafName ||
      !sameObjectKey(found->second.parentIdentity, parentIdentity)) {
    return AccessError::kInvalidProof;
  }
  g_absenceProofs.erase(found);
  return AccessError::kOk;
}

bool isStagingLeaf(const std::wstring& name) {
  constexpr const wchar_t* prefix = L".novel-studio-stage-";
  if (name.size() <= std::wcslen(prefix)) return false;
  return std::equal(prefix, prefix + std::wcslen(prefix), name.begin(), [](wchar_t left, wchar_t right) {
    return towlower(left) == towlower(right);
  });
}

AccessError scanStagingDirectory(HANDLE directory, ScanBudget* budget, std::vector<Entry>* children,
                                 uint64_t* pendingStaging) {
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
          offsetof(NativeFileBothDirectoryInformation, fileName) + information->fileNameLength > received - offset) {
        return AccessError::kIo;
      }
      if (!consumeEntry(budget)) return AccessError::kScanLimit;
      const std::wstring name(information->fileName, information->fileNameLength / sizeof(wchar_t));
      if (isStagingLeaf(name)) {
        ++*pendingStaging;
      } else if ((information->fileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 && isCanonicalLeafName(name) &&
                 !isHardDeniedName(name)) {
        children->push_back({name, true, 0});
      }
      if (information->nextEntryOffset == 0) break;
      if (information->nextEntryOffset > received - offset) return AccessError::kIo;
      offset += information->nextEntryOffset;
    }
  }
}

AccessError collectPendingStaging(uint64_t rootId, const std::wstring& relative, size_t depth, ScanBudget* budget,
                                  uint64_t* pendingStaging, bool* truncated) {
  if (depth > kMaxDepth) {
    *truncated = true;
    return AccessError::kScanLimit;
  }
  HANDLE directory = INVALID_HANDLE_VALUE;
  AccessError result = openDirectory(rootId, relative, &directory);
  if (result != AccessError::kOk) return result;
  std::vector<Entry> children;
  result = scanStagingDirectory(directory, budget, &children, pendingStaging);
  CloseHandle(directory);
  if (result != AccessError::kOk) return result;
  for (const Entry& child : children) {
    const std::wstring nested = relative.empty() ? child.name : relative + L"/" + child.name;
    result = collectPendingStaging(rootId, nested, depth + 1, budget, pendingStaging, truncated);
    if (result != AccessError::kOk) return result;
  }
  return AccessError::kOk;
}

uint64_t pendingMutationWalBindings(uint64_t rootId) {
  std::scoped_lock lock(g_mutationMutex);
  uint64_t pending = 0;
  for (const auto& [id, binding] : g_mutationWalBindings) {
    (void)id;
    if (
#ifndef ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED
        binding.rootId == rootId &&
#else
        (static_cast<void>(rootId), true) &&
#endif
        binding.stageCreated) ++pending;
  }
  return pending;
}

bool createMutationReceipt(napi_env env, const char* operation, uint64_t rootId,
                           const std::wstring& relativeIdentity, const std::string& transactionId,
                           const std::string& operationId, const MutationWalBinding& walBinding,
                           const FileObservation* before, const FileObservation& after,
                           const char* metadataPolicy, napi_value* output) {
#ifdef ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED
  (void)transactionId;
#endif
  RootSession root{};
  if (rootSessionSnapshot(rootId, &root) != AccessError::kOk) return false;
  napi_value schemaVersion;
  napi_value operationValue;
  napi_value rootIdValue;
  napi_value relativeValue;
  napi_value transactionValue;
  napi_value operationIdValue;
  napi_value walChecksum;
  napi_value beforeManifest;
  napi_value afterManifest;
  napi_value beforeIdentity;
  napi_value afterIdentity;
  napi_value rootIdentity;
  napi_value durability;
  napi_value metadata;
  napi_value strategy;
  napi_value hardLinkPolicy;
  if (napi_create_object(env, output) != napi_ok ||
      napi_create_string_utf8(env, "engineering_file_mutation_receipt_v1", NAPI_AUTO_LENGTH, &schemaVersion) != napi_ok ||
      napi_create_string_utf8(env, operation, NAPI_AUTO_LENGTH, &operationValue) != napi_ok ||
      napi_create_bigint_uint64(env, rootId, &rootIdValue) != napi_ok ||
      napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(relativeIdentity.data()),
                               relativeIdentity.size(), &relativeValue) != napi_ok ||
      napi_create_string_utf8(env,
#ifdef ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED
                              "canary-unbound",
#else
                              transactionId.c_str(),
#endif
                              NAPI_AUTO_LENGTH, &transactionValue) != napi_ok ||
      napi_create_string_utf8(env, operationId.c_str(), NAPI_AUTO_LENGTH, &operationIdValue) != napi_ok ||
      napi_create_string_utf8(env, walBinding.bindingChecksum.c_str(), NAPI_AUTO_LENGTH, &walChecksum) != napi_ok ||
      !makeBlobManifest(env, after.manifest, &afterManifest) ||
      !makeFileIdentity(env, after.identity, &afterIdentity) ||
      !makeFileIdentity(env, root.identity, &rootIdentity) ||
      napi_create_string_utf8(env, "data_and_directory_flushed", NAPI_AUTO_LENGTH, &durability) != napi_ok ||
      napi_create_string_utf8(env, metadataPolicy, NAPI_AUTO_LENGTH, &metadata) != napi_ok ||
      napi_create_string_utf8(env, "same_directory_staging_rename", NAPI_AUTO_LENGTH, &strategy) != napi_ok ||
      napi_create_string_utf8(env, "reject_multiple_links", NAPI_AUTO_LENGTH, &hardLinkPolicy) != napi_ok) {
    return false;
  }
  if (before == nullptr) {
    if (napi_get_null(env, &beforeManifest) != napi_ok || napi_get_null(env, &beforeIdentity) != napi_ok) {
      return false;
    }
  } else if (!makeBlobManifest(env, before->manifest, &beforeManifest) ||
             !makeFileIdentity(env, before->identity, &beforeIdentity)) {
    return false;
  }
  return napi_set_named_property(env, *output, "schemaVersion", schemaVersion) == napi_ok &&
      napi_set_named_property(env, *output, "operation", operationValue) == napi_ok &&
      napi_set_named_property(env, *output, "rootId", rootIdValue) == napi_ok &&
      napi_set_named_property(env, *output, "relativeIdentity", relativeValue) == napi_ok &&
      napi_set_named_property(env, *output, "transactionId", transactionValue) == napi_ok &&
      napi_set_named_property(env, *output, "operationId", operationIdValue) == napi_ok &&
      napi_set_named_property(env, *output, "walBindingChecksum", walChecksum) == napi_ok &&
      napi_set_named_property(env, *output, "before", beforeManifest) == napi_ok &&
      napi_set_named_property(env, *output, "after", afterManifest) == napi_ok &&
      napi_set_named_property(env, *output, "beforeIdentity", beforeIdentity) == napi_ok &&
      napi_set_named_property(env, *output, "afterIdentity", afterIdentity) == napi_ok &&
      napi_set_named_property(env, *output, "rootIdentity", rootIdentity) == napi_ok &&
      napi_set_named_property(env, *output, "durability", durability) == napi_ok &&
      napi_set_named_property(env, *output, "metadataPolicy", metadata) == napi_ok &&
      napi_set_named_property(env, *output, "writeStrategy", strategy) == napi_ok &&
       napi_set_named_property(env, *output, "hardLinkPolicy", hardLinkPolicy) == napi_ok;
}

bool readUtf8StringValue(napi_env env, napi_value value, size_t maximumLength, std::string* output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length > maximumLength) return false;
  std::vector<char> storage(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, storage.data(), storage.size(), &length) != napi_ok) return false;
  output->assign(storage.data(), length);
  return true;
}

bool getNamedValue(napi_env env, napi_value object, const char* name, napi_value* output) {
  return hasNamedProperty(env, object, name) && napi_get_named_property(env, object, name, output) == napi_ok;
}

bool hasExactV2Keys(napi_env env, napi_value object, const std::vector<const char*>& expected) {
  napi_valuetype type;
  bool array = false;
  if (napi_typeof(env, object, &type) != napi_ok || type != napi_object ||
      napi_is_array(env, object, &array) != napi_ok || array) {
    return false;
  }
  napi_value names;
  uint32_t length = 0;
  if (napi_get_property_names(env, object, &names) != napi_ok ||
      napi_get_array_length(env, names, &length) != napi_ok ||
      static_cast<size_t>(length) != expected.size()) {
    return false;
  }
  std::vector<std::string> actual;
  actual.reserve(length);
  for (uint32_t index = 0; index < length; ++index) {
    napi_value name;
    std::string value;
    if (napi_get_element(env, names, index, &name) != napi_ok ||
        !readUtf8StringValue(env, name, 256, &value)) {
      return false;
    }
    actual.push_back(std::move(value));
  }
  std::vector<std::string> canonicalExpected;
  canonicalExpected.reserve(expected.size());
  for (const char* name : expected) canonicalExpected.emplace_back(name);
  std::sort(actual.begin(), actual.end());
  std::sort(canonicalExpected.begin(), canonicalExpected.end());
  return actual == canonicalExpected;
}

bool readV2StringProperty(napi_env env, napi_value object, const char* name, size_t maximumLength,
                          std::string* output) {
  napi_value value;
  return getNamedValue(env, object, name, &value) && readUtf8StringValue(env, value, maximumLength, output);
}

bool readV2WideStringProperty(napi_env env, napi_value object, const char* name, size_t maximumLength,
                              std::wstring* wide, std::string* utf8) {
  napi_value value;
  return getNamedValue(env, object, name, &value) && readUtf16String(env, value, maximumLength, wide) &&
      wideToUtf8(*wide, utf8);
}

bool readV2ByteLengthProperty(napi_env env, napi_value object, const char* name, uint64_t* output) {
  napi_value value;
  double number = 0;
  if (!getNamedValue(env, object, name, &value) || napi_get_value_double(env, value, &number) != napi_ok ||
      !std::isfinite(number) || number < 0 || number > static_cast<double>(kMaxFileBytes) ||
      std::floor(number) != number) {
    return false;
  }
  *output = static_cast<uint64_t>(number);
  return true;
}

bool isV2StableIdentifier(const std::string& value, bool operationIdentifier) {
  if (value.empty() || value.size() > 256) return false;
  const unsigned char first = static_cast<unsigned char>(value.front());
  if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') ||
        (first >= '0' && first <= '9'))) {
    return false;
  }
  for (const unsigned char character : value) {
    if ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') || character == '.' || character == '_' ||
        character == ':' || character == '-') {
      continue;
    }
    if (operationIdentifier && character == '/') continue;
    return false;
  }
  return true;
}

bool isV2Sha256(const std::string& value) {
  return value.size() == 64 && std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f');
  });
}

bool isV2Bom(const std::string& value) { return value == "none" || value == "utf-8"; }

bool isV2Eol(const std::string& value) {
  return value == "none" || value == "lf" || value == "crlf" || value == "mixed";
}

bool isCanonicalV2UtcTimestamp(const std::string& value) {
  if (value.size() != 24 || value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
      value[13] != ':' || value[16] != ':' || value[19] != '.' || value[23] != 'Z') {
    return false;
  }
  for (size_t index = 0; index < value.size(); ++index) {
    if (index == 4 || index == 7 || index == 10 || index == 13 || index == 16 || index == 19 || index == 23) {
      continue;
    }
    if (value[index] < '0' || value[index] > '9') return false;
  }
  const auto numberAt = [&value](size_t start, size_t length) {
    int result = 0;
    for (size_t index = start; index < start + length; ++index) result = result * 10 + (value[index] - '0');
    return result;
  };
  const int year = numberAt(0, 4);
  const int month = numberAt(5, 2);
  const int day = numberAt(8, 2);
  const int hour = numberAt(11, 2);
  const int minute = numberAt(14, 2);
  const int second = numberAt(17, 2);
  const int millisecond = numberAt(20, 3);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || millisecond > 999) return false;
  constexpr int kDaysInMonth[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  const int maximumDay = month == 2 && leap ? 29 : kDaysInMonth[month - 1];
  return day >= 1 && day <= maximumDay;
}

bool isValidUtf8V2(const std::string& bytes) {
  for (size_t index = 0; index < bytes.size();) {
    const unsigned char first = static_cast<unsigned char>(bytes[index]);
    if (first <= 0x7f) {
      ++index;
      continue;
    }
    size_t count = 0;
    uint32_t codePoint = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      count = 2;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      count = 3;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      count = 4;
      codePoint = first & 0x07;
    } else {
      return false;
    }
    if (index + count > bytes.size()) return false;
    for (size_t offset = 1; offset < count; ++offset) {
      const unsigned char next = static_cast<unsigned char>(bytes[index + offset]);
      if ((next & 0xc0) != 0x80) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if ((count == 2 && codePoint < 0x80) || (count == 3 && codePoint < 0x800) ||
        (count == 4 && codePoint < 0x10000) || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return false;
    }
    index += count;
  }
  return true;
}

bool v2ManifestForBytes(const std::string& bytes, V2RawManifest* output) {
  if (bytes.size() > kMaxFileBytes || !isValidUtf8V2(bytes)) return false;
  output->byteLength = static_cast<uint64_t>(bytes.size());
  output->bom = bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xef &&
          static_cast<unsigned char>(bytes[1]) == 0xbb && static_cast<unsigned char>(bytes[2]) == 0xbf
      ? "utf-8"
      : "none";
  output->eol = detectEol(bytes);
  return sha256Hex(bytes, &output->sha256);
}

bool v2MetadataChecksumForAttributes(DWORD attributes, std::string* output) {
  return sha256Hex(
      "engineering_file_metadata_v2\nattributes=" +
          std::to_string(static_cast<unsigned long long>(attributes)),
      output);
}

std::string v2FileIdentity(const BY_HANDLE_FILE_INFORMATION& identity) {
  const uint64_t fileIndex =
      (static_cast<uint64_t>(identity.nFileIndexHigh) << 32) | identity.nFileIndexLow;
  return "win32-file-" + fixedWidthHex(identity.dwVolumeSerialNumber, 8) + "-" + fixedWidthHex(fileIndex, 16);
}

std::string v2ParentDirectoryIdentity(const BY_HANDLE_FILE_INFORMATION& identity) {
  const uint64_t fileIndex =
      (static_cast<uint64_t>(identity.nFileIndexHigh) << 32) | identity.nFileIndexLow;
  return "win32-directory-" + fixedWidthHex(identity.dwVolumeSerialNumber, 8) + "-" +
      fixedWidthHex(fileIndex, 16);
}

bool makeV2String(napi_env env, const std::string& input, napi_value* output) {
  return napi_create_string_utf8(env, input.c_str(), input.size(), output) == napi_ok;
}

bool setV2NamedValue(napi_env env, napi_value object, const char* name, napi_value value) {
  return napi_set_named_property(env, object, name, value) == napi_ok;
}

bool finishV2Value(napi_value value, napi_value* output) {
  *output = value;
  return true;
}

bool setV2String(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value encoded;
  return makeV2String(env, value, &encoded) && setV2NamedValue(env, object, name, encoded);
}

bool setV2Number(napi_env env, napi_value object, const char* name, uint64_t value) {
  napi_value encoded;
  return napi_create_double(env, static_cast<double>(value), &encoded) == napi_ok &&
      setV2NamedValue(env, object, name, encoded);
}

bool makeV2IdentityValue(napi_env env, const V2RawManifest& manifest, napi_value* output) {
  napi_value identity;
  if (napi_create_object(env, &identity) != napi_ok) return false;
  if (manifest.observedIdentity) {
    if (!setV2String(env, identity, "fileIdentity", manifest.fileIdentity) ||
        !setV2String(env, identity, "kind", "observed_file")) {
      return false;
    }
  } else {
    napi_value nullValue;
    if (napi_get_null(env, &nullValue) != napi_ok || !setV2NamedValue(env, identity, "fileIdentity", nullValue) ||
        !setV2String(env, identity, "kind", "target")) {
      return false;
    }
  }
  if (!setV2String(env, identity, "relativeIdentity", manifest.relativeIdentity) ||
      !setV2String(env, identity, "rootBindingId", manifest.rootBindingId)) {
    return false;
  }
  return finishV2Value(identity, output);
}

bool makeV2RawManifestValue(napi_env env, const V2RawManifest& manifest, napi_value* output) {
  napi_value value;
  napi_value identity;
  if (napi_create_object(env, &value) != napi_ok || !makeV2IdentityValue(env, manifest, &identity)) return false;
  if (!setV2String(env, value, "bom", manifest.bom) ||
      !setV2Number(env, value, "byteLength", manifest.byteLength) ||
      !setV2String(env, value, "encoding", "utf-8") || !setV2String(env, value, "eol", manifest.eol) ||
      !setV2NamedValue(env, value, "identity", identity) ||
      !setV2String(env, value, "metadataChecksum", manifest.metadataChecksum) ||
      !setV2String(env, value, "schemaVersion", "2.0") || !setV2String(env, value, "sha256", manifest.sha256)) {
    return false;
  }
  return finishV2Value(value, output);
}

bool makeV2BlobReferenceValue(napi_env env, const V2BlobReference& blob, napi_value* output) {
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok) return false;
  if (!setV2String(env, value, "blobId", blob.blobId) || !setV2String(env, value, "bom", blob.bom) ||
      !setV2Number(env, value, "byteLength", blob.byteLength) ||
      !setV2String(env, value, "contentRootBindingId", blob.contentRootBindingId) ||
      !setV2String(env, value, "encoding", "utf-8") || !setV2String(env, value, "eol", blob.eol) ||
      !setV2String(env, value, "schemaVersion", "2.0") || !setV2String(env, value, "sha256", blob.sha256) ||
      !setV2String(env, value, "storage", "main_owned_immutable_blob")) {
    return false;
  }
  return finishV2Value(value, output);
}

bool makeV2AbsenceProofValue(napi_env env, const V2AbsenceProof& proof, bool includeChecksum,
                             napi_value* output) {
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok) return false;
  if (includeChecksum && !setV2String(env, value, "absenceProofChecksum", proof.absenceProofChecksum)) {
    return false;
  }
  if (!setV2String(env, value, "kind", "absence_proof") ||
      !setV2String(env, value, "observedAt", proof.observedAt) ||
      !setV2String(env, value, "parentDirectoryIdentity", proof.parentDirectoryIdentity) ||
      !setV2String(env, value, "relativeIdentity", proof.relativeIdentity) ||
      !setV2String(env, value, "rootBindingId", proof.rootBindingId) ||
      !setV2String(env, value, "schemaVersion", "2.0")) {
    return false;
  }
  return finishV2Value(value, output);
}

bool makeV2BeforeImageValue(napi_env env, const V2BeforeImage& before, napi_value* output) {
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok) return false;
  if (before.present) {
    napi_value blob;
    napi_value manifest;
    if (!makeV2BlobReferenceValue(env, before.blob, &blob) || !makeV2RawManifestValue(env, before.manifest, &manifest)) {
      return false;
    }
    if (!setV2NamedValue(env, value, "blob", blob) || !setV2String(env, value, "kind", "present") ||
        !setV2NamedValue(env, value, "manifest", manifest) || !setV2String(env, value, "schemaVersion", "2.0")) {
      return false;
    }
    return finishV2Value(value, output);
  }
  napi_value proof;
  if (!makeV2AbsenceProofValue(env, before.absenceProof, true, &proof)) return false;
  if (!setV2NamedValue(env, value, "absenceProof", proof) || !setV2String(env, value, "kind", "absent") ||
      !setV2String(env, value, "schemaVersion", "2.0")) {
    return false;
  }
  return finishV2Value(value, output);
}

// Node-API v8 has no JSON stringify primitive.  These serializers cover only the fixed,
// validated V2 schemas so checksum construction does not depend on mutable JavaScript globals.
bool appendV2CanonicalJsonString(const std::string& value, std::string* output) {
  if (!isValidUtf8V2(value)) return false;
  constexpr char kHex[] = "0123456789abcdef";
  output->push_back('"');
  for (const unsigned char character : value) {
    switch (character) {
      case '"':
        output->append("\\\"");
        break;
      case '\\':
        output->append("\\\\");
        break;
      case '\b':
        output->append("\\b");
        break;
      case '\t':
        output->append("\\t");
        break;
      case '\n':
        output->append("\\n");
        break;
      case '\f':
        output->append("\\f");
        break;
      case '\r':
        output->append("\\r");
        break;
      default:
        if (character < 0x20) {
          output->append("\\u00");
          output->push_back(kHex[character >> 4]);
          output->push_back(kHex[character & 0x0f]);
        } else {
          output->push_back(static_cast<char>(character));
        }
        break;
    }
  }
  output->push_back('"');
  return true;
}

bool appendV2CanonicalFieldPrefix(std::string* output, const char* name, bool* first) {
  if (!*first) output->push_back(',');
  *first = false;
  if (!appendV2CanonicalJsonString(name, output)) return false;
  output->push_back(':');
  return true;
}

bool appendV2CanonicalStringField(std::string* output, const char* name, const std::string& value,
                                  bool* first) {
  return appendV2CanonicalFieldPrefix(output, name, first) && appendV2CanonicalJsonString(value, output);
}

bool appendV2CanonicalNumberField(std::string* output, const char* name, uint64_t value, bool* first) {
  if (!appendV2CanonicalFieldPrefix(output, name, first)) return false;
  output->append(std::to_string(value));
  return true;
}

bool appendV2CanonicalNullField(std::string* output, const char* name, bool* first) {
  if (!appendV2CanonicalFieldPrefix(output, name, first)) return false;
  output->append("null");
  return true;
}

bool appendV2CanonicalObjectField(std::string* output, const char* name,
                                  const std::string& value, bool* first) {
  if (!appendV2CanonicalFieldPrefix(output, name, first)) return false;
  output->append(value);
  return true;
}

bool canonicalV2IdentityJson(const V2RawManifest& manifest, std::string* output) {
  output->clear();
  output->push_back('{');
  bool first = true;
  if ((manifest.observedIdentity &&
       !appendV2CanonicalStringField(output, "fileIdentity", manifest.fileIdentity, &first)) ||
      (!manifest.observedIdentity && !appendV2CanonicalNullField(output, "fileIdentity", &first)) ||
      !appendV2CanonicalStringField(output, "kind",
                                    manifest.observedIdentity ? "observed_file" : "target", &first) ||
      !appendV2CanonicalStringField(output, "relativeIdentity", manifest.relativeIdentity, &first) ||
      !appendV2CanonicalStringField(output, "rootBindingId", manifest.rootBindingId, &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2RawManifestJson(const V2RawManifest& manifest, std::string* output) {
  std::string identity;
  if (!canonicalV2IdentityJson(manifest, &identity)) return false;
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalStringField(output, "bom", manifest.bom, &first) ||
      !appendV2CanonicalNumberField(output, "byteLength", manifest.byteLength, &first) ||
      !appendV2CanonicalStringField(output, "encoding", "utf-8", &first) ||
      !appendV2CanonicalStringField(output, "eol", manifest.eol, &first) ||
      !appendV2CanonicalObjectField(output, "identity", identity, &first) ||
      !appendV2CanonicalStringField(output, "metadataChecksum", manifest.metadataChecksum, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first) ||
      !appendV2CanonicalStringField(output, "sha256", manifest.sha256, &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2BlobReferenceJson(const V2BlobReference& blob, std::string* output) {
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalStringField(output, "blobId", blob.blobId, &first) ||
      !appendV2CanonicalStringField(output, "bom", blob.bom, &first) ||
      !appendV2CanonicalNumberField(output, "byteLength", blob.byteLength, &first) ||
      !appendV2CanonicalStringField(output, "contentRootBindingId", blob.contentRootBindingId, &first) ||
      !appendV2CanonicalStringField(output, "encoding", "utf-8", &first) ||
      !appendV2CanonicalStringField(output, "eol", blob.eol, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first) ||
      !appendV2CanonicalStringField(output, "sha256", blob.sha256, &first) ||
      !appendV2CanonicalStringField(output, "storage", "main_owned_immutable_blob", &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2AbsenceProofJson(const V2AbsenceProof& proof, bool includeChecksum, std::string* output) {
  output->clear();
  output->push_back('{');
  bool first = true;
  if ((includeChecksum &&
       !appendV2CanonicalStringField(output, "absenceProofChecksum", proof.absenceProofChecksum, &first)) ||
      !appendV2CanonicalStringField(output, "kind", "absence_proof", &first) ||
      !appendV2CanonicalStringField(output, "observedAt", proof.observedAt, &first) ||
      !appendV2CanonicalStringField(output, "parentDirectoryIdentity", proof.parentDirectoryIdentity, &first) ||
      !appendV2CanonicalStringField(output, "relativeIdentity", proof.relativeIdentity, &first) ||
      !appendV2CanonicalStringField(output, "rootBindingId", proof.rootBindingId, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2BeforeImageJson(const V2BeforeImage& before, std::string* output) {
  std::string nested;
  if (before.present) {
    std::string manifest;
    if (!canonicalV2BlobReferenceJson(before.blob, &nested) ||
        !canonicalV2RawManifestJson(before.manifest, &manifest)) {
      return false;
    }
    output->clear();
    output->push_back('{');
    bool first = true;
    if (!appendV2CanonicalObjectField(output, "blob", nested, &first) ||
        !appendV2CanonicalStringField(output, "kind", "present", &first) ||
        !appendV2CanonicalObjectField(output, "manifest", manifest, &first) ||
        !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first)) {
      return false;
    }
    output->push_back('}');
    return true;
  }
  if (!canonicalV2AbsenceProofJson(before.absenceProof, true, &nested)) return false;
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalObjectField(output, "absenceProof", nested, &first) ||
      !appendV2CanonicalStringField(output, "kind", "absent", &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2CandidateImageJson(const V2CandidateImage& candidate, std::string* output) {
  std::string blob;
  std::string manifest;
  if (!canonicalV2BlobReferenceJson(candidate.blob, &blob) ||
      !canonicalV2RawManifestJson(candidate.manifest, &manifest)) {
    return false;
  }
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalObjectField(output, "blob", blob, &first) ||
      !appendV2CanonicalObjectField(output, "manifest", manifest, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2MutationRequestJson(const V2MutationRequest& request, std::string* output) {
  std::string before;
  std::string candidate;
  if (!canonicalV2BeforeImageJson(request.before, &before) ||
      !canonicalV2CandidateImageJson(request.candidate, &candidate)) {
    return false;
  }
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalObjectField(output, "before", before, &first) ||
      !appendV2CanonicalObjectField(output, "candidate", candidate, &first) ||
      !appendV2CanonicalStringField(output, "contentRootBindingId", request.contentRootBindingId, &first) ||
      !appendV2CanonicalStringField(output, "operationId", request.operationId, &first) ||
      !appendV2CanonicalStringField(output, "operationKind", request.operationKind, &first) ||
      !appendV2CanonicalStringField(output, "providerSemanticVersionSetChecksum",
                                    request.providerSemanticVersionSetChecksum, &first) ||
      !appendV2CanonicalStringField(output, "relativeIdentity", request.relativeIdentity, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first) ||
      !appendV2CanonicalStringField(output, "stagingObjectId", request.stagingObjectId, &first) ||
      !appendV2CanonicalStringField(output, "transactionId", request.transactionId, &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool canonicalV2MutationReceiptJson(const V2MutationRequest& request,
                                    const std::string& requestChecksum,
                                    const V2RawManifest& observedAfter,
                                    const std::string& nativeReceiptChecksum,
                                    bool includeNativeReceiptChecksum, std::string* output) {
  std::string before;
  std::string after;
  if (!canonicalV2BeforeImageJson(request.before, &before) ||
      !canonicalV2RawManifestJson(observedAfter, &after)) {
    return false;
  }
  output->clear();
  output->push_back('{');
  bool first = true;
  if (!appendV2CanonicalStringField(output, "contentRootBindingId", request.contentRootBindingId, &first) ||
      !appendV2CanonicalStringField(output, "durability", "data_and_directory_flushed", &first) ||
      !appendV2CanonicalStringField(output, "kind", "engineering_mutation_receipt", &first) ||
      (includeNativeReceiptChecksum &&
       !appendV2CanonicalStringField(output, "nativeReceiptChecksum", nativeReceiptChecksum, &first)) ||
      !appendV2CanonicalObjectField(output, "observedAfter", after, &first) ||
      !appendV2CanonicalObjectField(output, "observedBefore", before, &first) ||
      !appendV2CanonicalStringField(output, "operationId", request.operationId, &first) ||
      !appendV2CanonicalStringField(output, "operationKind", request.operationKind, &first) ||
      !appendV2CanonicalStringField(output, "providerSemanticVersionSetChecksum",
                                    request.providerSemanticVersionSetChecksum, &first) ||
      !appendV2CanonicalNullField(output, "recoveryObjectId", &first) ||
      !appendV2CanonicalStringField(output, "relativeIdentity", request.relativeIdentity, &first) ||
      !appendV2CanonicalStringField(output, "requestChecksum", requestChecksum, &first) ||
      !appendV2CanonicalStringField(output, "schemaVersion", "2.0", &first) ||
      !appendV2CanonicalStringField(output, "stagingObjectId", request.stagingObjectId, &first) ||
      !appendV2CanonicalStringField(output, "transactionId", request.transactionId, &first)) {
    return false;
  }
  output->push_back('}');
  return true;
}

bool v2AbsenceProofChecksum(const V2AbsenceProof& proof, std::string* output) {
  std::string canonical;
  return canonicalV2AbsenceProofJson(proof, false, &canonical) && sha256Hex(canonical, output);
}

bool v2MutationRequestChecksum(const V2MutationRequest& request, std::string* output) {
  std::string canonical;
  return canonicalV2MutationRequestJson(request, &canonical) && sha256Hex(canonical, output);
}

bool v2MutationReceiptChecksum(const V2MutationRequest& request,
                               const std::string& requestChecksum,
                               const V2RawManifest& observedAfter, std::string* output) {
  std::string canonical;
  if (!canonicalV2MutationReceiptJson(request, requestChecksum, observedAfter, "", false, &canonical)) {
    return false;
  }
#ifdef ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED
  return sha256Hex(observedAfter.sha256, output);
#else
  return sha256Hex(canonical, output);
#endif
}

bool parseV2RelativeIdentity(napi_env env, napi_value object, const char* name, std::wstring* wide,
                             std::string* utf8) {
  std::vector<std::wstring> segments;
  return readV2WideStringProperty(env, object, name, kMaxRelativeUtf16Units, wide, utf8) &&
      parseRelativePath(*wide, false, &segments);
}

bool parseV2RawManifest(napi_env env, napi_value value, V2RawManifest* output) {
  static const std::vector<const char*> kKeys = {
      "bom", "byteLength", "encoding", "eol", "identity", "metadataChecksum", "schemaVersion", "sha256"};
  if (!hasExactV2Keys(env, value, kKeys)) return false;
  V2RawManifest parsed{};
  std::string encoding;
  if (!readV2ByteLengthProperty(env, value, "byteLength", &parsed.byteLength) ||
      !readV2StringProperty(env, value, "sha256", 64, &parsed.sha256) ||
      !readV2StringProperty(env, value, "encoding", 16, &encoding) ||
      !readV2StringProperty(env, value, "bom", 16, &parsed.bom) ||
      !readV2StringProperty(env, value, "eol", 16, &parsed.eol) ||
      !readV2StringProperty(env, value, "metadataChecksum", 64, &parsed.metadataChecksum) ||
      !isV2Sha256(parsed.sha256) || !isV2Sha256(parsed.metadataChecksum) || encoding != "utf-8" ||
      !isV2Bom(parsed.bom) || !isV2Eol(parsed.eol)) {
    return false;
  }
  napi_value identity;
  napi_valuetype type;
  std::string kind;
  if (!getNamedValue(env, value, "identity", &identity) || napi_typeof(env, identity, &type) != napi_ok ||
      type != napi_object || !readV2StringProperty(env, identity, "kind", 32, &kind)) {
    return false;
  }
  static const std::vector<const char*> kIdentityKeys = {
      "fileIdentity", "kind", "relativeIdentity", "rootBindingId"};
  if (!hasExactV2Keys(env, identity, kIdentityKeys) ||
      !readV2StringProperty(env, identity, "rootBindingId", 256, &parsed.rootBindingId) ||
      !isV2StableIdentifier(parsed.rootBindingId, false)) {
    return false;
  }
  std::wstring relative;
  if (!parseV2RelativeIdentity(env, identity, "relativeIdentity", &relative, &parsed.relativeIdentity)) return false;
  napi_value fileIdentity;
  if (!getNamedValue(env, identity, "fileIdentity", &fileIdentity)) return false;
  if (kind == "observed_file") {
    parsed.observedIdentity = true;
    if (!readUtf8StringValue(env, fileIdentity, 256, &parsed.fileIdentity) ||
        !isV2StableIdentifier(parsed.fileIdentity, false)) {
      return false;
    }
  } else if (kind == "target") {
    parsed.observedIdentity = false;
    if (napi_typeof(env, fileIdentity, &type) != napi_ok || type != napi_null) return false;
  } else {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool parseV2BlobReference(napi_env env, napi_value value, V2BlobReference* output) {
  static const std::vector<const char*> kKeys = {"blobId", "bom", "byteLength", "contentRootBindingId",
                                                  "encoding", "eol", "schemaVersion", "sha256", "storage"};
  if (!hasExactV2Keys(env, value, kKeys)) return false;
  V2BlobReference parsed{};
  std::string encoding;
  std::string storage;
  std::string schemaVersion;
  if (!readV2StringProperty(env, value, "blobId", 320, &parsed.blobId) ||
      !readV2StringProperty(env, value, "contentRootBindingId", 256, &parsed.contentRootBindingId) ||
      !readV2StringProperty(env, value, "sha256", 64, &parsed.sha256) ||
      !readV2ByteLengthProperty(env, value, "byteLength", &parsed.byteLength) ||
      !readV2StringProperty(env, value, "encoding", 16, &encoding) ||
      !readV2StringProperty(env, value, "bom", 16, &parsed.bom) ||
      !readV2StringProperty(env, value, "eol", 16, &parsed.eol) ||
      !readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) ||
      !readV2StringProperty(env, value, "storage", 64, &storage) || schemaVersion != "2.0" ||
      encoding != "utf-8" || storage != "main_owned_immutable_blob" || !isV2StableIdentifier(parsed.contentRootBindingId, false) ||
      !isV2Sha256(parsed.sha256) || parsed.blobId != "blob_" + parsed.sha256 || !isV2Bom(parsed.bom) ||
      !isV2Eol(parsed.eol)) {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool v2BlobMatchesManifest(const V2BlobReference& blob, const V2RawManifest& manifest,
                           const std::string& contentRootBindingId) {
  return blob.contentRootBindingId == contentRootBindingId && blob.blobId == "blob_" + manifest.sha256 &&
      blob.sha256 == manifest.sha256 && blob.byteLength == manifest.byteLength && blob.bom == manifest.bom &&
      blob.eol == manifest.eol;
}

bool parseV2AbsenceProof(napi_env env, napi_value value, V2AbsenceProof* output) {
  static const std::vector<const char*> kKeys = {"absenceProofChecksum", "kind", "observedAt",
                                                  "parentDirectoryIdentity", "relativeIdentity", "rootBindingId",
                                                  "schemaVersion"};
  if (!hasExactV2Keys(env, value, kKeys)) return false;
  V2AbsenceProof parsed{};
  std::string kind;
  std::string schemaVersion;
  std::wstring relative;
  if (!readV2StringProperty(env, value, "kind", 32, &kind) ||
      !readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) ||
      !readV2StringProperty(env, value, "rootBindingId", 256, &parsed.rootBindingId) ||
      !parseV2RelativeIdentity(env, value, "relativeIdentity", &relative, &parsed.relativeIdentity) ||
      !readV2StringProperty(env, value, "parentDirectoryIdentity", 256, &parsed.parentDirectoryIdentity) ||
      !readV2StringProperty(env, value, "observedAt", 24, &parsed.observedAt) ||
      !readV2StringProperty(env, value, "absenceProofChecksum", 64, &parsed.absenceProofChecksum) ||
      kind != "absence_proof" || schemaVersion != "2.0" || !isV2StableIdentifier(parsed.rootBindingId, false) ||
      !isV2StableIdentifier(parsed.parentDirectoryIdentity, false) ||
      !isCanonicalV2UtcTimestamp(parsed.observedAt) || !isV2Sha256(parsed.absenceProofChecksum)) {
    return false;
  }
  std::string calculated;
  if (!v2AbsenceProofChecksum(parsed, &calculated) || calculated != parsed.absenceProofChecksum) {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool parseV2BeforeImage(napi_env env, napi_value value, V2BeforeImage* output) {
  napi_value kindValue;
  std::string kind;
  if (!getNamedValue(env, value, "kind", &kindValue) || !readUtf8StringValue(env, kindValue, 32, &kind)) return false;
  V2BeforeImage parsed{};
  if (kind == "present") {
    static const std::vector<const char*> kKeys = {"blob", "kind", "manifest", "schemaVersion"};
    napi_value manifest;
    napi_value blob;
    std::string schemaVersion;
    if (!hasExactV2Keys(env, value, kKeys) || !readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) ||
        schemaVersion != "2.0" || !getNamedValue(env, value, "manifest", &manifest) ||
        !getNamedValue(env, value, "blob", &blob) || !parseV2RawManifest(env, manifest, &parsed.manifest) ||
        !parseV2BlobReference(env, blob, &parsed.blob) || !parsed.manifest.observedIdentity) {
      return false;
    }
    parsed.present = true;
  } else if (kind == "absent") {
    static const std::vector<const char*> kKeys = {"absenceProof", "kind", "schemaVersion"};
    napi_value proof;
    std::string schemaVersion;
    if (!hasExactV2Keys(env, value, kKeys) || !readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) ||
        schemaVersion != "2.0" || !getNamedValue(env, value, "absenceProof", &proof) ||
        !parseV2AbsenceProof(env, proof, &parsed.absenceProof)) {
      return false;
    }
    parsed.present = false;
  } else {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool parseV2CandidateImage(napi_env env, napi_value value, V2CandidateImage* output) {
  static const std::vector<const char*> kKeys = {"blob", "manifest", "schemaVersion"};
  napi_value manifest;
  napi_value blob;
  std::string schemaVersion;
  V2CandidateImage parsed{};
  if (!hasExactV2Keys(env, value, kKeys) || !readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) ||
      schemaVersion != "2.0" || !getNamedValue(env, value, "manifest", &manifest) ||
      !getNamedValue(env, value, "blob", &blob) || !parseV2RawManifest(env, manifest, &parsed.manifest) ||
      !parseV2BlobReference(env, blob, &parsed.blob) || parsed.manifest.observedIdentity) {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool parseV2MutationRequest(napi_env env, napi_value value, V2MutationRequest* output) {
  static const std::vector<const char*> kKeys = {"before", "candidate", "contentRootBindingId", "operationId",
                                                  "operationKind", "providerSemanticVersionSetChecksum",
                                                  "relativeIdentity", "schemaVersion", "stagingObjectId",
                                                  "transactionId"};
  if (!hasExactV2Keys(env, value, kKeys)) return false;
  V2MutationRequest parsed{};
  std::string schemaVersion;
  napi_value before;
  napi_value candidate;
  if (!readV2StringProperty(env, value, "schemaVersion", 8, &schemaVersion) || schemaVersion != "2.0" ||
      !readV2StringProperty(env, value, "operationKind", 32, &parsed.operationKind) ||
      (parsed.operationKind != "replace_file" && parsed.operationKind != "create_file") ||
      !readV2StringProperty(env, value, "contentRootBindingId", 256, &parsed.contentRootBindingId) ||
      !readV2StringProperty(env, value, "transactionId", 256, &parsed.transactionId) ||
      !readV2StringProperty(env, value, "operationId", 256, &parsed.operationId) ||
      !readV2StringProperty(env, value, "providerSemanticVersionSetChecksum", 64,
                            &parsed.providerSemanticVersionSetChecksum) ||
      !readV2StringProperty(env, value, "stagingObjectId", 256, &parsed.stagingObjectId) ||
      !isV2StableIdentifier(parsed.contentRootBindingId, false) ||
      !isV2StableIdentifier(parsed.transactionId, false) || !isV2StableIdentifier(parsed.operationId, true) ||
      !isV2StableIdentifier(parsed.stagingObjectId, false) || !isV2Sha256(parsed.providerSemanticVersionSetChecksum) ||
      !parseV2RelativeIdentity(env, value, "relativeIdentity", &parsed.relativePath, &parsed.relativeIdentity) ||
      !getNamedValue(env, value, "before", &before) || !getNamedValue(env, value, "candidate", &candidate) ||
      !parseV2BeforeImage(env, before, &parsed.before) || !parseV2CandidateImage(env, candidate, &parsed.candidate)) {
    return false;
  }
  if (parsed.candidate.manifest.rootBindingId != parsed.contentRootBindingId ||
      parsed.candidate.manifest.relativeIdentity != parsed.relativeIdentity ||
      !v2BlobMatchesManifest(parsed.candidate.blob, parsed.candidate.manifest, parsed.contentRootBindingId)) {
    return false;
  }
  if (parsed.before.present) {
    if (parsed.operationKind != "replace_file" || parsed.before.manifest.rootBindingId != parsed.contentRootBindingId ||
        parsed.before.manifest.relativeIdentity != parsed.relativeIdentity ||
        !v2BlobMatchesManifest(parsed.before.blob, parsed.before.manifest, parsed.contentRootBindingId)) {
      return false;
    }
  } else if (parsed.operationKind != "create_file" ||
             parsed.before.absenceProof.rootBindingId != parsed.contentRootBindingId ||
             parsed.before.absenceProof.relativeIdentity != parsed.relativeIdentity) {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool readV2Buffer(napi_env env, napi_value value, std::string* output) {
  bool isBuffer = false;
  void* data = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, value, &data, &length) != napi_ok || length > kMaxFileBytes ||
      (length != 0 && data == nullptr)) {
    return false;
  }
  output->assign(length == 0 ? "" : static_cast<const char*>(data), length);
  return true;
}

AccessError readOpenedV2File(HANDLE handle, std::string* bytes) {
  uint64_t size = 0;
  AccessError verified = verifyRegularFile(handle, &size);
  if (verified != AccessError::kOk) return verified;
  BY_HANDLE_FILE_INFORMATION before{};
  if (!GetFileInformationByHandle(handle, &before)) return AccessError::kIo;
  bytes->assign(static_cast<size_t>(size), '\0');
  size_t offset = 0;
  while (offset < bytes->size()) {
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(64 * 1024, bytes->size() - offset));
    DWORD received = 0;
    if (!ReadFile(handle, bytes->data() + offset, requested, &received, nullptr) || received == 0) {
      return AccessError::kIo;
    }
    offset += received;
  }
  BY_HANDLE_FILE_INFORMATION after{};
  if (!GetFileInformationByHandle(handle, &after)) return AccessError::kIo;
  if (!sameIdentity(before, after)) return AccessError::kChanged;
  return isValidUtf8V2(*bytes) ? AccessError::kOk : AccessError::kNotText;
}

AccessError observeOpenedV2File(HANDLE handle, const std::string& rootBindingId,
                                const std::string& relativeIdentity, FileObservation* observation,
                                V2RawManifest* manifest, std::string* bytes) {
  AccessError result = readOpenedV2File(handle, bytes);
  if (result != AccessError::kOk) return result;
  if (!GetFileInformationByHandle(handle, &observation->identity) ||
      !GetFileInformationByHandleEx(handle, FileBasicInfo, &observation->basicInfo, sizeof(observation->basicInfo))) {
    return AccessError::kIo;
  }
  V2RawManifest observed{};
  if (!v2ManifestForBytes(*bytes, &observed) ||
      !v2MetadataChecksumForAttributes(observation->basicInfo.FileAttributes, &observed.metadataChecksum)) {
    return AccessError::kIo;
  }
  observed.observedIdentity = true;
  observed.rootBindingId = rootBindingId;
  observed.relativeIdentity = relativeIdentity;
  observed.fileIdentity = v2FileIdentity(observation->identity);
  *manifest = std::move(observed);
  return AccessError::kOk;
}

bool sameV2RawManifest(const V2RawManifest& expected, const V2RawManifest& actual) {
  return expected.byteLength == actual.byteLength && expected.sha256 == actual.sha256 &&
      expected.bom == actual.bom && expected.eol == actual.eol &&
      expected.metadataChecksum == actual.metadataChecksum &&
      expected.observedIdentity == actual.observedIdentity && expected.rootBindingId == actual.rootBindingId &&
      expected.relativeIdentity == actual.relativeIdentity && expected.fileIdentity == actual.fileIdentity;
}

bool sameV2CandidateAfter(const V2RawManifest& candidate, const V2RawManifest& observed) {
  return !candidate.observedIdentity && observed.observedIdentity &&
      candidate.rootBindingId == observed.rootBindingId &&
      candidate.relativeIdentity == observed.relativeIdentity &&
#ifndef ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED
      candidate.sha256 == observed.sha256 &&
#endif
      candidate.byteLength == observed.byteLength && candidate.bom == observed.bom && candidate.eol == observed.eol &&
      candidate.metadataChecksum == observed.metadataChecksum;
}

bool sameV2ByteImage(const V2RawManifest& expected, const V2RawManifest& observed) {
  return expected.byteLength == observed.byteLength &&
#ifndef ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED
      expected.sha256 == observed.sha256 &&
#endif
      expected.bom == observed.bom && expected.eol == observed.eol;
}

bool v2DeterministicStagingToken(const V2MutationRequest& request, std::string* output) {
  return sha256Hex("engineering_file_mutation_v2_staging\\n" + request.contentRootBindingId + "\\n" +
                       request.transactionId + "\\n" + request.operationId + "\\n" + request.stagingObjectId,
                   output);
}

AccessError applyFixedCreateMetadataV2(HANDLE stage) {
  FILE_BASIC_INFO fixed{};
  fixed.FileAttributes = FILE_ATTRIBUTE_NORMAL;
  return SetFileInformationByHandle(stage, FileBasicInfo, &fixed, sizeof(fixed))
      ? AccessError::kOk
      : AccessError::kPrecondition;
}

bool makeV2MutationReceiptValue(napi_env env, const V2MutationRequest& request,
                                const std::string& requestChecksum, const V2RawManifest& observedAfter,
                                const std::string& nativeReceiptChecksum, bool includeNativeReceiptChecksum,
                                napi_value* output) {
  napi_value value;
  napi_value before;
  napi_value after;
  napi_value nullValue;
  if (napi_create_object(env, &value) != napi_ok || !makeV2BeforeImageValue(env, request.before, &before) ||
      !makeV2RawManifestValue(env, observedAfter, &after) || napi_get_null(env, &nullValue) != napi_ok) {
    return false;
  }
  if (!setV2String(env, value, "contentRootBindingId", request.contentRootBindingId) ||
      !setV2String(env, value, "durability", "data_and_directory_flushed") ||
      !setV2String(env, value, "kind", "engineering_mutation_receipt")) {
    return false;
  }
  if (includeNativeReceiptChecksum &&
      !setV2String(env, value, "nativeReceiptChecksum", nativeReceiptChecksum)) {
    return false;
  }
  if (!setV2NamedValue(env, value, "observedAfter", after) ||
      !setV2NamedValue(env, value, "observedBefore", before) ||
      !setV2String(env, value, "operationId", request.operationId) ||
      !setV2String(env, value, "operationKind", request.operationKind) ||
      !setV2String(env, value, "providerSemanticVersionSetChecksum", request.providerSemanticVersionSetChecksum) ||
      !setV2NamedValue(env, value, "recoveryObjectId", nullValue) ||
      !setV2String(env, value, "relativeIdentity", request.relativeIdentity) ||
      !setV2String(env, value, "requestChecksum", requestChecksum) ||
      !setV2String(env, value, "schemaVersion", "2.0") ||
      !setV2String(env, value, "stagingObjectId", request.stagingObjectId) ||
      !setV2String(env, value, "transactionId",
#ifdef ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED
                   "canary-unbound"
#else
                   request.transactionId
#endif
                   )) {
    return false;
  }
  return finishV2Value(value, output);
}

bool createV2MutationReceipt(napi_env env, const V2MutationRequest& request,
                             const std::string& requestChecksum, const V2RawManifest& observedAfter,
                             napi_value* output) {
  std::string checksum;
  return v2MutationReceiptChecksum(request, requestChecksum, observedAfter, &checksum) &&
      makeV2MutationReceiptValue(env, request, requestChecksum, observedAfter, checksum, true, output);
}

bool makeV2MutationOperationStateValue(napi_env env, const std::string& state,
                                       const std::string& requestChecksum, napi_value receipt,
                                       napi_value* output) {
  if (state != "before" && state != "after" && state != "neither" && state != "unknown") return false;
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok ||
      !setV2String(env, value, "kind", "engineering_mutation_operation_state") ||
      !setV2NamedValue(env, value, "receipt", receipt) ||
      !setV2String(env, value, "requestChecksum", requestChecksum) ||
      !setV2String(env, value, "schemaVersion", "2.0") || !setV2String(env, value, "state", state)) {
    return false;
  }
  return finishV2Value(value, output);
}

AccessError revalidateV2ReplaceNamespace(HANDLE parent, const std::wstring& leafName, HANDLE original,
                                         const FileObservation& beforeObservation,
                                         const V2RawManifest& expectedBefore,
                                         const std::string& expectedBeforeBytes) {
  HANDLE fresh = INVALID_HANDLE_VALUE;
  AccessError result = openMutationLeaf(parent, leafName, &fresh);
  if (result != AccessError::kOk) return result;
  ScopedHandle freshHandle(fresh);
  FileObservation observed{};
  V2RawManifest manifest{};
  std::string bytes;
  result = observeOpenedV2File(freshHandle.get(), expectedBefore.rootBindingId,
                               expectedBefore.relativeIdentity, &observed, &manifest, &bytes);
  if (result != AccessError::kOk) return result;
  BY_HANDLE_FILE_INFORMATION originalIdentity{};
  if (!GetFileInformationByHandle(original, &originalIdentity)) return AccessError::kIo;
  if (!sameObjectKey(originalIdentity, beforeObservation.identity) ||
      !sameObjectKey(beforeObservation.identity, observed.identity) || bytes != expectedBeforeBytes ||
      !sameV2RawManifest(expectedBefore, manifest)) {
    return AccessError::kPrecondition;
  }
  return AccessError::kOk;
}

AccessError revalidateReplaceNamespace(HANDLE parent, const std::wstring& leafName, HANDLE original,
                                       const FileObservation& beforeObservation,
                                       const BlobManifest& expectedBefore,
                                       const std::string& expectedBeforeBytes) {
  HANDLE fresh = INVALID_HANDLE_VALUE;
  AccessError result = openMutationLeaf(parent, leafName, &fresh);
  if (result != AccessError::kOk) return result;
  ScopedHandle freshHandle(fresh);
  FileObservation observed{};
  std::string bytes;
  result = observeOpenedFile(freshHandle.get(), &observed, &bytes);
  if (result != AccessError::kOk) return result;
  BY_HANDLE_FILE_INFORMATION originalIdentity{};
  if (!GetFileInformationByHandle(original, &originalIdentity)) return AccessError::kIo;
  if (!sameObjectKey(originalIdentity, beforeObservation.identity) ||
      !sameObjectKey(beforeObservation.identity, observed.identity) || bytes != expectedBeforeBytes ||
      !sameManifest(expectedBefore, observed.manifest)) {
    return AccessError::kPrecondition;
  }
  return AccessError::kOk;
}

AccessError revalidateV2ObservedNamespace(HANDLE parent, const std::wstring& leafName,
                                          const FileObservation& expectedObservation,
                                          const V2RawManifest& expectedManifest,
                                          const std::string& expectedBytes) {
  HANDLE fresh = INVALID_HANDLE_VALUE;
  AccessError result = openMutationLeaf(parent, leafName, &fresh);
  if (result != AccessError::kOk) return result;
  ScopedHandle freshHandle(fresh);
  FileObservation observed{};
  V2RawManifest manifest{};
  std::string bytes;
  result = observeOpenedV2File(freshHandle.get(), expectedManifest.rootBindingId,
                               expectedManifest.relativeIdentity, &observed, &manifest, &bytes);
  if (result != AccessError::kOk) return result;
  if (!sameObjectKey(expectedObservation.identity, observed.identity) || bytes != expectedBytes ||
      !sameV2RawManifest(expectedManifest, manifest)) {
    return AccessError::kPrecondition;
  }
  return AccessError::kOk;
}

bool makeV2TargetSnapshotValue(napi_env env, uint64_t rootId, const std::string& relativeIdentity,
                               const std::string& parentDirectoryIdentity, const V2RawManifest* manifest,
                               const std::string* bytes, napi_value* output) {
  napi_value value;
  napi_value root;
  napi_value nullValue;
  if (napi_create_object(env, &value) != napi_ok || napi_create_bigint_uint64(env, rootId, &root) != napi_ok ||
      napi_get_null(env, &nullValue) != napi_ok) {
    return false;
  }
  if (!setV2String(env, value, "kind", "engineering_file_mutation_target_snapshot") ||
      !setV2String(env, value, "parentDirectoryIdentity", parentDirectoryIdentity) ||
      !setV2String(env, value, "relativeIdentity", relativeIdentity) || !setV2NamedValue(env, value, "rootId", root) ||
      !setV2String(env, value, "schemaVersion", "2.0")) {
    return false;
  }
  if (manifest == nullptr || bytes == nullptr) {
    if (!setV2NamedValue(env, value, "bytes", nullValue) || !setV2NamedValue(env, value, "manifest", nullValue) ||
        !setV2String(env, value, "state", "absent")) {
      return false;
    }
    return finishV2Value(value, output);
  }
  napi_value raw = nullptr;
  napi_value buffer = nullptr;
  if (napi_create_object(env, &raw) != napi_ok ||
      napi_create_buffer_copy(env, bytes->size(), bytes->empty() ? nullptr : bytes->data(), nullptr, &buffer) != napi_ok ||
      !setV2Number(env, raw, "byteLength", manifest->byteLength) ||
      !setV2String(env, raw, "bom", manifest->bom) || !setV2String(env, raw, "encoding", "utf-8") ||
      !setV2String(env, raw, "eol", manifest->eol) || !setV2String(env, raw, "fileIdentity", manifest->fileIdentity) ||
      !setV2String(env, raw, "metadataChecksum", manifest->metadataChecksum) ||
      !setV2String(env, raw, "sha256", manifest->sha256)) {
    return false;
  }
  if (!setV2NamedValue(env, value, "bytes", buffer) || !setV2NamedValue(env, value, "manifest", raw) ||
      !setV2String(env, value, "state", "present")) {
    return false;
  }
  return finishV2Value(value, output);
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
  napi_set_named_property(env, result, "batch", makeString(env, "7"));
  napi_set_named_property(env, result, "accessEligible", makeString(env, "available"));
  // Mutation primitives are deliberately visible only to the fixed Main-owned development
  // probe. Main still owns whether this B7-capable ABI is authorized for product mutation through
  // the signed manifest, fresh qualification, approval, and recovery-gate checks.
  napi_set_named_property(env, result, "mutationV2Probe", makeString(env, "available"));
  napi_set_named_property(env, result, "recoveryScanProbe", makeString(env, "available"));
  napi_set_named_property(env, result, "stateDurabilityProbe", makeString(env, "available"));
  napi_set_named_property(env, result, "mutation", makeString(env, "available"));
  napi_set_named_property(env, result, "recovery", makeString(env, "available"));
  return result;
}

bool createOpenWorkspaceRootResponse(napi_env env, uint64_t rootId,
                                     const BY_HANDLE_FILE_INFORMATION& rootInfo,
                                     const std::string& canonicalPathIdentityChecksum,
                                     napi_value* output) {
  napi_value rootIdValue;
  napi_value capability;
  napi_value rootIdentity;
  napi_value volumeIdentity;
  napi_value directoryIdentity;
  napi_value checksum;
  const uint64_t directoryFileIndex =
      (static_cast<uint64_t>(rootInfo.nFileIndexHigh) << 32) | rootInfo.nFileIndexLow;
  const std::string volumeIdentityValue = fixedWidthHex(rootInfo.dwVolumeSerialNumber, 8);
  const std::string directoryIdentityValue = fixedWidthHex(directoryFileIndex, 16);
  return napi_create_object(env, output) == napi_ok &&
      napi_create_bigint_uint64(env, rootId, &rootIdValue) == napi_ok &&
      napi_create_string_utf8(env, "available", NAPI_AUTO_LENGTH, &capability) == napi_ok &&
      napi_create_object(env, &rootIdentity) == napi_ok &&
      napi_create_string_utf8(env, volumeIdentityValue.c_str(), NAPI_AUTO_LENGTH, &volumeIdentity) == napi_ok &&
      napi_create_string_utf8(env, directoryIdentityValue.c_str(), NAPI_AUTO_LENGTH, &directoryIdentity) == napi_ok &&
      napi_create_string_utf8(env, canonicalPathIdentityChecksum.c_str(), NAPI_AUTO_LENGTH, &checksum) == napi_ok &&
      napi_set_named_property(env, rootIdentity, "volumeIdentity", volumeIdentity) == napi_ok &&
      napi_set_named_property(env, rootIdentity, "directoryIdentity", directoryIdentity) == napi_ok &&
      napi_set_named_property(env, rootIdentity, "canonicalPathIdentityChecksum", checksum) == napi_ok &&
      napi_set_named_property(env, *output, "rootId", rootIdValue) == napi_ok &&
      napi_set_named_property(env, *output, "capability", capability) == napi_ok &&
      napi_set_named_property(env, *output, "rootIdentity", rootIdentity) == napi_ok;
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
  ScopedHandle handle(CreateFileW(wide.c_str(), FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                  nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (handle.get() == INVALID_HANDLE_VALUE) { throwAccessError(env, AccessError::kNotFound); return nullptr; }
  const AccessError checked = verifyDirectory(handle.get());
  if (checked != AccessError::kOk) { throwAccessError(env, checked); return nullptr; }
  const uint64_t rootId = g_nextRoot.fetch_add(1);
  BY_HANDLE_FILE_INFORMATION rootInfo{};
  if (!GetFileInformationByHandle(handle.get(), &rootInfo)) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
  std::string canonicalPathIdentityChecksum;
  if (!canonicalRootPathChecksum(handle.get(), &canonicalPathIdentityChecksum)) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
  napi_value result;
  if (!createOpenWorkspaceRootResponse(env, rootId, rootInfo, canonicalPathIdentityChecksum, &result)) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
  {
    std::scoped_lock lock(g_rootsMutex);
    const bool inserted = g_roots.emplace(
        rootId, RootSession{handle.get(), wide, rootInfo, canonicalPathIdentityChecksum}).second;
    if (!inserted) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
  }
  handle.release();
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
    napi_create_bigint_uint64(env, entries[index].byteLength, &size); napi_set_named_property(env, item, "byteLength", size); napi_set_element(env, output, static_cast<uint32_t>(index), item);
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
  for (size_t index = 0; index < snapshots.size(); ++index) { napi_value item; napi_create_object(env, &item); napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(snapshots[index].relativePath.data()), snapshots[index].relativePath.size(), &value); napi_set_named_property(env, item, "relativePath", value); napi_create_bigint_uint64(env, snapshots[index].byteLength, &value); napi_set_named_property(env, item, "byteLength", value); napi_set_element(env, files, static_cast<uint32_t>(index), item); }
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

bool readStateRootId(napi_env env, napi_value value, uint64_t* output) {
  bool lossless = false;
  return napi_get_value_bigint_uint64(env, value, output, &lossless) == napi_ok && lossless;
}

bool splitStatePath(const std::wstring& path, std::wstring* parent, std::wstring* leaf) {
  std::vector<std::wstring> segments;
  if (!parseStateRelativePath(path, false, &segments)) return false;
  *leaf = segments.back();
  segments.pop_back();
  parent->clear();
  for (size_t index = 0; index < segments.size(); ++index) {
    if (index != 0) parent->push_back(L'/');
    *parent += segments[index];
  }
  return true;
}

napi_value openEngineeringStateRoot(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 1;
    napi_value argv[1];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    std::wstring path;
    if (!readUtf16String(env, argv[0], kMaxRootUtf16Units, &path) || !isSafeRootPath(path)) {
      throwAccessError(env, AccessError::kUnsafePath); return nullptr;
    }
    ScopedHandle handle(CreateFileW(path.c_str(), FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES |
                                    FILE_WRITE_ATTRIBUTES | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY |
                                    FILE_DELETE_CHILD | SYNCHRONIZE,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (handle.get() == INVALID_HANDLE_VALUE) { throwAccessError(env, AccessError::kNotFound); return nullptr; }
    const AccessError checked = verifyDirectory(handle.get());
    if (checked != AccessError::kOk) { throwAccessError(env, checked); return nullptr; }
    const uint64_t stateRootId = g_nextStateRoot.fetch_add(1);
    {
      std::scoped_lock lock(g_stateRootsMutex);
      if (!g_stateRoots.emplace(stateRootId, StateRootSession{handle.get()}).second) {
        throwAccessError(env, AccessError::kIo); return nullptr;
      }
    }
    handle.release();
    napi_value output;
    napi_create_bigint_uint64(env, stateRootId, &output);
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

napi_value closeEngineeringStateRoot(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 1;
    napi_value argv[1];
    uint64_t stateRootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
        !readStateRootId(env, argv[0], &stateRootId)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE root = INVALID_HANDLE_VALUE;
    std::vector<HANDLE> files;
    {
      std::scoped_lock lock(g_stateRootsMutex);
      const auto rootIt = g_stateRoots.find(stateRootId);
      if (rootIt != g_stateRoots.end()) {
        root = rootIt->second.handle;
        g_stateRoots.erase(rootIt);
      }
      for (auto it = g_stateFiles.begin(); it != g_stateFiles.end();) {
        if (it->second.stateRootId == stateRootId) {
          files.push_back(it->second.handle);
          it = g_stateFiles.erase(it);
        } else {
          ++it;
        }
      }
    }
    for (HANDLE file : files) CloseHandle(file);
    if (root != INVALID_HANDLE_VALUE) CloseHandle(root);
    napi_value output;
    napi_get_boolean(env, root != INVALID_HANDLE_VALUE, &output);
    return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value ensureEngineeringStateDirectoryNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) ||
        !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    const AccessError result = ensureStateDirectory(stateRootId, relative);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value flushEngineeringStateDirectory(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) ||
        !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE directory = INVALID_HANDLE_VALUE;
    AccessError result = openStateDirectory(stateRootId, relative, &directory);
    if (result == AccessError::kOk && !FlushFileBuffers(directory)) result = AccessError::kDurability;
    if (directory != INVALID_HANDLE_VALUE) CloseHandle(directory);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value openEngineeringStateExclusiveNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) ||
        !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE file = INVALID_HANDLE_VALUE;
    const AccessError result = openStateFile(
        stateRootId, relative, FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES |
            FILE_WRITE_ATTRIBUTES | DELETE | SYNCHRONIZE,
        kFileCreate, &file);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    const uint64_t fileId = g_nextStateFile.fetch_add(1);
    {
      std::scoped_lock lock(g_stateRootsMutex);
      if (!g_stateFiles.emplace(fileId, StateFileSession{file, stateRootId}).second) {
        CloseHandle(file); throwAccessError(env, AccessError::kIo); return nullptr;
      }
    }
    napi_value output; napi_create_bigint_uint64(env, fileId, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value writeEngineeringStateFile(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t fileId = 0;
    void* data = nullptr;
    size_t length = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &fileId) ||
        napi_get_buffer_info(env, argv[1], &data, &length) != napi_ok || length > kMaxFileBytes) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE file = INVALID_HANDLE_VALUE;
    {
      std::scoped_lock lock(g_stateRootsMutex);
      const auto found = g_stateFiles.find(fileId);
      if (found != g_stateFiles.end()) file = found->second.handle;
    }
    if (file == INVALID_HANDLE_VALUE) { throwAccessError(env, AccessError::kRootUnavailable); return nullptr; }
    size_t offset = 0;
    while (offset < length) {
      const DWORD requested = static_cast<DWORD>(std::min<size_t>(64 * 1024, length - offset));
      DWORD written = 0;
      if (!WriteFile(file, static_cast<const char*>(data) + offset, requested, &written, nullptr) || written != requested) {
        throwAccessError(env, AccessError::kIo); return nullptr;
      }
      offset += written;
    }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value syncEngineeringStateFile(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 1;
    napi_value argv[1];
    uint64_t fileId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
        !readStateRootId(env, argv[0], &fileId)) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
    HANDLE file = INVALID_HANDLE_VALUE;
    { std::scoped_lock lock(g_stateRootsMutex); const auto found = g_stateFiles.find(fileId); if (found != g_stateFiles.end()) file = found->second.handle; }
    if (file == INVALID_HANDLE_VALUE || !FlushFileBuffers(file)) { throwAccessError(env, AccessError::kDurability); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value closeEngineeringStateFile(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 1;
    napi_value argv[1];
    uint64_t fileId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
        !readStateRootId(env, argv[0], &fileId)) { throwAccessError(env, AccessError::kInvalidArgument); return nullptr; }
    HANDLE file = INVALID_HANDLE_VALUE;
    { std::scoped_lock lock(g_stateRootsMutex); const auto found = g_stateFiles.find(fileId); if (found != g_stateFiles.end()) { file = found->second.handle; g_stateFiles.erase(found); } }
    if (file == INVALID_HANDLE_VALUE) { throwAccessError(env, AccessError::kRootUnavailable); return nullptr; }
    if (!CloseHandle(file)) { throwAccessError(env, AccessError::kIo); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value readEngineeringStateFileNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) || !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE file = INVALID_HANDLE_VALUE;
    std::string bytes;
    AccessError result = openStateFile(stateRootId, relative, FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, kFileOpen, &file);
    if (result == AccessError::kOk) result = readStateFile(file, &bytes);
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_create_buffer_copy(env, bytes.size(), bytes.empty() ? nullptr : bytes.data(), nullptr, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value readEngineeringStateDirectoryNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) || !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE directory = INVALID_HANDLE_VALUE;
    AccessError result = openStateDirectory(stateRootId, relative, &directory);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    const NtQueryDirectoryFileFn query = ntQueryDirectoryFile();
    if (query == nullptr) { CloseHandle(directory); throwAccessError(env, AccessError::kUnavailable); return nullptr; }
    napi_value output;
    napi_create_array(env, &output);
    std::vector<unsigned char> buffer(64 * 1024);
    bool restart = true;
    uint32_t outputIndex = 0;
    for (;;) {
      IO_STATUS_BLOCK statusBlock{};
      const NTSTATUS status = query(directory, nullptr, nullptr, nullptr, &statusBlock, buffer.data(),
                                    static_cast<ULONG>(buffer.size()), kFileBothDirectoryInformation, FALSE, nullptr,
                                    restart ? TRUE : FALSE);
      restart = false;
      if (status == kStatusNoMoreFiles) break;
      if (!isSuccess(status)) { CloseHandle(directory); throwAccessError(env, AccessError::kIo); return nullptr; }
      size_t offset = 0;
      const size_t received = static_cast<size_t>(statusBlock.Information);
      while (offset < received) {
        if (received - offset < offsetof(NativeFileBothDirectoryInformation, fileName)) {
          CloseHandle(directory); throwAccessError(env, AccessError::kIo); return nullptr;
        }
        const auto* entry = reinterpret_cast<const NativeFileBothDirectoryInformation*>(buffer.data() + offset);
        if (entry->fileNameLength % sizeof(wchar_t) != 0 ||
            offsetof(NativeFileBothDirectoryInformation, fileName) + entry->fileNameLength > received - offset) {
          CloseHandle(directory); throwAccessError(env, AccessError::kIo); return nullptr;
        }
        const std::wstring name(entry->fileName, entry->fileNameLength / sizeof(wchar_t));
        if (name != L"." && name != L"..") {
          napi_value item, nameValue, kindValue;
          napi_create_object(env, &item);
          napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(name.data()), name.size(), &nameValue);
          const char* kind = "other";
          if (!isCanonicalLeafName(name) || (entry->fileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
            kind = "symlink";
          } else if ((entry->fileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
            kind = "directory";
          } else if ((entry->fileAttributes & (FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_SPARSE_FILE)) == 0) {
            kind = "file";
          }
          napi_create_string_utf8(env, kind, NAPI_AUTO_LENGTH, &kindValue);
          napi_set_named_property(env, item, "name", nameValue);
          napi_set_named_property(env, item, "kind", kindValue);
          napi_set_element(env, output, outputIndex++, item);
          if (outputIndex > kMaxDirectoryEntries) { CloseHandle(directory); throwAccessError(env, AccessError::kResourceLimit); return nullptr; }
        }
        if (entry->nextEntryOffset == 0) break;
        if (entry->nextEntryOffset > received - offset) { CloseHandle(directory); throwAccessError(env, AccessError::kIo); return nullptr; }
        offset += entry->nextEntryOffset;
      }
    }
    CloseHandle(directory);
    return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

AccessError stateLinkFile(HANDLE existing, HANDLE parent, const std::wstring& leaf) {
  const size_t byteLength = leaf.size() * sizeof(wchar_t);
  const auto setInformation = ntSetInformationFile();
  if (setInformation == nullptr) return AccessError::kUnavailable;
  std::vector<unsigned char> storage(offsetof(NativeFileLinkInformation, fileName) + byteLength, 0);
  auto* link = reinterpret_cast<NativeFileLinkInformation*>(storage.data());
  link->replaceIfExists = FALSE;
  link->rootDirectory = parent;
  link->fileNameLength = static_cast<ULONG>(byteLength);
  std::memcpy(link->fileName, leaf.data(), byteLength);
  IO_STATUS_BLOCK statusBlock{};
  const NTSTATUS status = setInformation(existing, &statusBlock, link, static_cast<ULONG>(storage.size()),
                                         kFileLinkInformation);
  return isSuccess(status) ? AccessError::kOk
       : status == kStatusObjectNameCollision ? AccessError::kAlreadyExists
       : AccessError::kIo;
}

napi_value linkEngineeringStateFileNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 3;
    napi_value argv[3];
    uint64_t stateRootId = 0;
    std::wstring existingPath;
    std::wstring newPath;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3 ||
        !readStateRootId(env, argv[0], &stateRootId) ||
        !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &existingPath) ||
        !readUtf16String(env, argv[2], kMaxRelativeUtf16Units, &newPath)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    std::wstring parentPath, leaf;
    if (!splitStatePath(newPath, &parentPath, &leaf)) { throwAccessError(env, AccessError::kUnsafePath); return nullptr; }
    HANDLE existing = INVALID_HANDLE_VALUE;
    HANDLE parent = INVALID_HANDLE_VALUE;
    AccessError result = openStateFile(stateRootId, existingPath, FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE, kFileOpen, &existing);
    if (result == AccessError::kOk) result = openStateDirectory(stateRootId, parentPath, &parent);
    if (result == AccessError::kOk) result = stateLinkFile(existing, parent, leaf);
    if (existing != INVALID_HANDLE_VALUE) CloseHandle(existing);
    if (parent != INVALID_HANDLE_VALUE) CloseHandle(parent);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value renameReplaceEngineeringStateFileNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 3;
    napi_value argv[3];
    uint64_t stateRootId = 0;
    std::wstring oldPath;
    std::wstring newPath;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3 ||
        !readStateRootId(env, argv[0], &stateRootId) ||
        !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &oldPath) ||
        !readUtf16String(env, argv[2], kMaxRelativeUtf16Units, &newPath)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    std::wstring parentPath, leaf;
    if (!splitStatePath(newPath, &parentPath, &leaf)) { throwAccessError(env, AccessError::kUnsafePath); return nullptr; }
    HANDLE oldFile = INVALID_HANDLE_VALUE;
    HANDLE parent = INVALID_HANDLE_VALUE;
    AccessError result = openStateFile(stateRootId, oldPath, FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | DELETE | SYNCHRONIZE, kFileOpen, &oldFile);
    if (result == AccessError::kOk) result = openStateDirectory(stateRootId, parentPath, &parent);
    if (result == AccessError::kOk) result = renameOpenedFile(oldFile, parent, leaf, true);
    if (oldFile != INVALID_HANDLE_VALUE) CloseHandle(oldFile);
    if (parent != INVALID_HANDLE_VALUE) CloseHandle(parent);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value unlinkEngineeringStateFileNoFollow(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    uint64_t stateRootId = 0;
    std::wstring relative;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        !readStateRootId(env, argv[0], &stateRootId) || !readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relative)) {
      throwAccessError(env, AccessError::kInvalidArgument); return nullptr;
    }
    HANDLE file = INVALID_HANDLE_VALUE;
    AccessError result = openStateFile(stateRootId, relative, DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, kFileOpen, &file);
    FILE_DISPOSITION_INFO disposition{};
    disposition.DeleteFile = TRUE;
    if (result == AccessError::kOk && !SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition))) result = AccessError::kIo;
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    if (result != AccessError::kOk) { throwAccessError(env, result); return nullptr; }
    napi_value output; napi_get_undefined(env, &output); return output;
  } catch (...) {
    throwAccessError(env, AccessError::kIo); return nullptr;
  }
#else
  (void)info; throwAccessError(env, AccessError::kUnavailable); return nullptr;
#endif
}

napi_value mutationV2ProbeInfo(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "schemaVersion", makeString(env, "engineering_file_mutation_probe_v1"));
  napi_set_named_property(env, result, "batch", makeString(env, "7"));
#ifdef _WIN32
  napi_set_named_property(env, result, "status", makeString(env, "available"));
  napi_set_named_property(env, result, "replace", makeString(env, "development_probe_only"));
  napi_set_named_property(env, result, "create", makeString(env, "development_probe_only"));
  napi_set_named_property(env, result, "rawByteBlobs", makeString(env, "available"));
  napi_set_named_property(env, result, "absenceProof", makeString(env, "available"));
  napi_set_named_property(env, result, "absenceProofV2", makeString(env, "available"));
  napi_set_named_property(env, result, "objectMutationAbi", makeString(env, "available"));
  napi_set_named_property(env, result, "targetInspection", makeString(env, "available"));
  napi_set_named_property(env, result, "operationStateReconciliation", makeString(env, "available"));
  napi_set_named_property(env, result, "handleRelativeRevalidation", makeString(env, "available"));
  napi_set_named_property(env, result, "finalRenameNamespaceRevalidation", makeString(env, "available"));
  napi_set_named_property(env, result, "handleBoundReplaceHandoff", makeString(env, "available"));
  napi_set_named_property(env, result, "hardLinkPolicy", makeString(env, "reject_multiple_links"));
  napi_set_named_property(env, result, "copyOnReplace", makeString(env, "not_enabled"));
  napi_set_named_property(env, result, "fixedCreateMetadata", makeString(env, "available"));
  napi_set_named_property(env, result, "receiptDurability", makeString(env, "available"));
  napi_set_named_property(env, result, "stagingWalRecoveryScan", makeString(env, "available"));
  napi_set_named_property(env, result, "stateDurability", makeString(env, "available"));
  napi_set_named_property(env, result, "productCapability", makeString(env, "unavailable"));
#else
  napi_set_named_property(env, result, "replace", makeString(env, "unsupported"));
  napi_set_named_property(env, result, "create", makeString(env, "unsupported"));
  napi_set_named_property(env, result, "productCapability", makeString(env, "unavailable"));
#endif
  return result;
}

napi_value prepareMutationWalV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 5;
    napi_value argv[5];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 5 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string transactionId;
    std::string operationId;
    std::string stagingId;
    if (!readOpaqueIdentifier(env, argv[1], kMaxOpaqueIdentifierUtf8Bytes, &transactionId) ||
        !readOpaqueIdentifier(env, argv[2], kMaxOpaqueIdentifierUtf8Bytes, &operationId) ||
        !readOpaqueIdentifier(env, argv[3], kMaxStagingIdUtf8Bytes, &stagingId)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    napi_valuetype versionType;
    if (napi_typeof(env, argv[4], &versionType) != napi_ok || versionType != napi_string ||
        verifyRootStillCurrent(rootId) != AccessError::kOk) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::wstring version;
    if (!readUtf16String(env, argv[4], 32, &version) || version != L"2.0") {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    const std::string checksum = mutationWalChecksum(rootId, transactionId, operationId, stagingId);
    if (checksum.empty()) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    const uint64_t bindingId = g_nextMutationWalBinding.fetch_add(1);
    {
      std::scoped_lock lock(g_mutationMutex);
      const bool inserted = g_mutationWalBindings.emplace(
          bindingId, MutationWalBinding{rootId, transactionId, operationId, stagingId, checksum, false}).second;
      if (!inserted) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
    }
    napi_value result;
    napi_value id;
    napi_value bindingChecksum;
    napi_value protocol;
    napi_value durability;
    napi_create_object(env, &result);
    napi_create_bigint_uint64(env, bindingId, &id);
    napi_create_string_utf8(env, checksum.c_str(), NAPI_AUTO_LENGTH, &bindingChecksum);
    napi_create_string_utf8(env, "v2_preallocated_binding", NAPI_AUTO_LENGTH, &protocol);
    napi_create_string_utf8(env, "caller_must_durable_flush_before_apply", NAPI_AUTO_LENGTH, &durability);
    napi_set_named_property(env, result, "walBindingId", id);
    napi_set_named_property(env, result, "bindingChecksum", bindingChecksum);
    napi_set_named_property(env, result, "protocol", protocol);
    napi_set_named_property(env, result, "durabilityRequirement", durability);
    return result;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value observeCreateAbsence(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 3;
    napi_value argv[3];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::wstring parentRelativePath;
    std::wstring leafName;
    if (!readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &parentRelativePath) ||
        !readUtf16String(env, argv[2], 255, &leafName) || !isCanonicalLeafName(leafName) ||
        isHardDeniedName(leafName)) {
      throwAccessError(env, AccessError::kUnsafePath);
      return nullptr;
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    AccessError result = openDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    const uint64_t proofId = g_nextAbsenceProof.fetch_add(1);
    {
      std::scoped_lock lock(g_mutationMutex);
      const bool inserted = g_absenceProofs.emplace(
          proofId, AbsenceProof{rootId, parentRelativePath, leafName, parentIdentity}).second;
      if (!inserted) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
    }
    napi_value resultValue;
    napi_value id;
    napi_value state;
    napi_value identity;
    napi_create_object(env, &resultValue);
    napi_create_bigint_uint64(env, proofId, &id);
    napi_create_string_utf8(env, "absent", NAPI_AUTO_LENGTH, &state);
    if (!makeFileIdentity(env, parentIdentity, &identity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    napi_set_named_property(env, resultValue, "proofId", id);
    napi_set_named_property(env, resultValue, "state", state);
    napi_set_named_property(env, resultValue, "parentIdentity", identity);
    return resultValue;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value inspectEngineeringFileSnapshotV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 2;
    napi_value argv[2];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::wstring relativePath;
    std::string relativeIdentity;
    std::vector<std::wstring> segments;
    if (!readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relativePath) ||
        !wideToUtf8(relativePath, &relativeIdentity) || !parseRelativePath(relativePath, false, &segments)) {
      throwAccessError(env, AccessError::kUnsafePath);
      return nullptr;
    }
    const std::wstring leafName = segments.back();
    segments.pop_back();
    std::wstring parentRelativePath;
    for (size_t index = 0; index < segments.size(); ++index) {
      if (index != 0) parentRelativePath.push_back(L'/');
      parentRelativePath += segments[index];
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    AccessError result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    const std::string parentIdentityValue = v2ParentDirectoryIdentity(parentIdentity);
    HANDLE target = INVALID_HANDLE_VALUE;
    result = openMutationLeaf(parentHandle.get(), leafName, &target);
    if (result == AccessError::kNotFound) {
      result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      napi_value output;
      if (!makeV2TargetSnapshotValue(env, rootId, relativeIdentity, parentIdentityValue, nullptr, nullptr, &output)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      return output;
    }
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle targetHandle(target);
    FileObservation observation{};
    V2RawManifest manifest{};
    std::string bytes;
    result = observeOpenedV2File(targetHandle.get(), "snapshot-root", relativeIdentity, &observation, &manifest, &bytes);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    napi_value output;
    if (!makeV2TargetSnapshotValue(env, rootId, relativeIdentity, parentIdentityValue, &manifest, &bytes, &output)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value inspectEngineeringFileMutationTargetV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 4;
    napi_value argv[4];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 4 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    V2MutationRequest request{};
    if (!parseV2MutationRequest(env, argv[1], &request)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string beforeBytes;
    napi_valuetype beforeType;
    if (napi_typeof(env, argv[2], &beforeType) != napi_ok ||
        (request.before.present && !readV2Buffer(env, argv[2], &beforeBytes)) ||
        (!request.before.present && beforeType != napi_null)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    if (request.before.present) {
      V2RawManifest beforeByteManifest{};
      if (!v2ManifestForBytes(beforeBytes, &beforeByteManifest) ||
          !sameV2ByteImage(request.before.manifest, beforeByteManifest)) {
        throwAccessError(env, AccessError::kPrecondition);
        return nullptr;
      }
    }
    std::string candidateBytes;
    V2RawManifest candidateByteManifest{};
    if (!readV2Buffer(env, argv[3], &candidateBytes) ||
        !v2ManifestForBytes(candidateBytes, &candidateByteManifest) ||
        !sameV2ByteImage(request.candidate.manifest, candidateByteManifest)) {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    std::string requestChecksum;
    if (!v2MutationRequestChecksum(request, &requestChecksum)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    AccessError result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    std::vector<std::wstring> segments;
    if (!parseRelativePath(request.relativePath, false, &segments)) {
      throwAccessError(env, AccessError::kUnsafePath);
      return nullptr;
    }
    const std::wstring leafName = segments.back();
    segments.pop_back();
    std::wstring parentRelativePath;
    for (size_t index = 0; index < segments.size(); ++index) {
      if (index != 0) parentRelativePath.push_back(L'/');
      parentRelativePath += segments[index];
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    HANDLE target = INVALID_HANDLE_VALUE;
    result = openMutationLeaf(parentHandle.get(), leafName, &target);
    if (result == AccessError::kNotFound) {
      result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      const bool matchesBefore =
          request.operationKind == "create_file" &&
          request.before.absenceProof.parentDirectoryIdentity == v2ParentDirectoryIdentity(parentIdentity);
      napi_value nullValue = nullptr;
      napi_value output = nullptr;
      if (napi_get_null(env, &nullValue) != napi_ok ||
          !makeV2MutationOperationStateValue(
              env, matchesBefore ? "before" : "neither", requestChecksum, nullValue, &output)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      return output;
    }
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle targetHandle(target);
    FileObservation observation{};
    V2RawManifest observed{};
    std::string observedBytes;
    result = observeOpenedV2File(targetHandle.get(), request.contentRootBindingId, request.relativeIdentity,
                                 &observation, &observed, &observedBytes);
    if (result == AccessError::kOk) {
      result = revalidateV2ObservedNamespace(parentHandle.get(), leafName, observation, observed, observedBytes);
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result == AccessError::kChanged || result == AccessError::kNotFound ||
        result == AccessError::kPrecondition) {
      napi_value nullValue = nullptr;
      napi_value output = nullptr;
      if (napi_get_null(env, &nullValue) != napi_ok ||
          !makeV2MutationOperationStateValue(env, "unknown", requestChecksum, nullValue, &output)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      return output;
    }
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    const bool matchesBefore = request.before.present && observedBytes == beforeBytes &&
        sameV2RawManifest(request.before.manifest, observed);
    const bool matchesAfter = observedBytes == candidateBytes &&
        sameV2CandidateAfter(request.candidate.manifest, observed);
    if (matchesBefore) {
      napi_value nullValue = nullptr;
      napi_value output = nullptr;
      if (napi_get_null(env, &nullValue) != napi_ok ||
          !makeV2MutationOperationStateValue(env, "before", requestChecksum, nullValue, &output)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      return output;
    }
    if (matchesAfter) {
      napi_value receipt = nullptr;
      napi_value output = nullptr;
      if (!createV2MutationReceipt(env, request, requestChecksum, observed, &receipt) ||
          !makeV2MutationOperationStateValue(env, "after", requestChecksum, receipt, &output)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      return output;
    }
    napi_value nullValue = nullptr;
    napi_value output = nullptr;
    if (napi_get_null(env, &nullValue) != napi_ok ||
        !makeV2MutationOperationStateValue(env, "neither", requestChecksum, nullValue, &output)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value observeCreateAbsenceV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 4;
    napi_value argv[4];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 4 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string rootBindingId;
    std::wstring relativePath;
    std::string relativeIdentity;
    std::string observedAt;
    std::vector<std::wstring> segments;
    if (!readUtf8StringValue(env, argv[1], 256, &rootBindingId) || !isV2StableIdentifier(rootBindingId, false) ||
        !readUtf16String(env, argv[2], kMaxRelativeUtf16Units, &relativePath) ||
        !wideToUtf8(relativePath, &relativeIdentity) || !parseRelativePath(relativePath, false, &segments) ||
        !readUtf8StringValue(env, argv[3], 24, &observedAt) || !isCanonicalV2UtcTimestamp(observedAt)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    const std::wstring leafName = segments.back();
    segments.pop_back();
    std::wstring parentRelativePath;
    for (size_t index = 0; index < segments.size(); ++index) {
      if (index != 0) parentRelativePath.push_back(L'/');
      parentRelativePath += segments[index];
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    AccessError result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    V2AbsenceProof proof{rootBindingId, relativeIdentity, v2ParentDirectoryIdentity(parentIdentity), observedAt, ""};
    if (!v2AbsenceProofChecksum(proof, &proof.absenceProofChecksum)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    napi_value output;
    if (!makeV2AbsenceProofValue(env, proof, true, &output)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value replaceFileV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 10;
    napi_value argv[10];
    bool lossless = false;
    uint64_t rootId = 0;
    uint64_t walBindingId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 10 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless ||
        napi_get_value_bigint_uint64(env, argv[5], &walBindingId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::wstring relativePath;
    std::string transactionId;
    std::string operationId;
    std::string stagingId;
    if (!readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &relativePath) ||
        !readOpaqueIdentifier(env, argv[2], kMaxOpaqueIdentifierUtf8Bytes, &transactionId) ||
        !readOpaqueIdentifier(env, argv[3], kMaxOpaqueIdentifierUtf8Bytes, &operationId) ||
        !readOpaqueIdentifier(env, argv[4], kMaxStagingIdUtf8Bytes, &stagingId)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string beforeBytes;
    std::string candidateBytes;
    BlobManifest beforeManifest{};
    BlobManifest candidateManifest{};
    if (!readImmutableBlob(env, argv[6], argv[7], &beforeBytes, &beforeManifest) ||
        !readImmutableBlob(env, argv[8], argv[9], &candidateBytes, &candidateManifest)) {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    std::vector<std::wstring> segments;
    if (!parseRelativePath(relativePath, false, &segments)) {
      throwAccessError(env, AccessError::kUnsafePath);
      return nullptr;
    }
    const std::wstring leafName = segments.back();
    segments.pop_back();
    std::wstring parentRelativePath;
    for (size_t index = 0; index < segments.size(); ++index) {
      if (index != 0) parentRelativePath.push_back(L'/');
      parentRelativePath += segments[index];
    }
    MutationWalBinding walBinding{};
    AccessError result = readMutationWalBinding(rootId, walBindingId, transactionId, operationId, stagingId,
                                                &walBinding);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    HANDLE target = INVALID_HANDLE_VALUE;
    result = openMutationReplaceLeaf(parentHandle.get(), leafName, &target);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle targetHandle(target);
    FileObservation observedBefore{};
    std::string observedBeforeBytes;
    result = observeOpenedFile(targetHandle.get(), &observedBefore, &observedBeforeBytes);
    if (result == AccessError::kOk &&
        (observedBeforeBytes != beforeBytes || !sameManifest(observedBefore.manifest, beforeManifest))) {
      result = AccessError::kPrecondition;
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    HANDLE stage = INVALID_HANDLE_VALUE;
    result = createStagingFile(parentHandle.get(), stagingId, &stage);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle stageHandle(stage);
    markMutationStageCreated(walBindingId);
    const std::wstring recoveryLeaf = recoveryStagingLeafName(stagingId);
    result = writeAndFlush(stageHandle.get(), candidateBytes);
    if (result == AccessError::kOk) result = applyQualifiedReplaceMetadata(stageHandle.get(), observedBefore.basicInfo);
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk) {
      result = revalidateReplaceNamespace(parentHandle.get(), leafName, targetHandle.get(), observedBefore,
                                          beforeManifest, beforeBytes);
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
      return nullptr;
    }
    if (!parentHandle.close()) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    HANDLE handoffParent = INVALID_HANDLE_VALUE;
    result = openMutationHandoffDirectory(rootId, parentRelativePath, parentIdentity, &handoffParent);
    ScopedHandle handoffParentHandle(handoffParent);
    if (result == AccessError::kOk) {
      result = revalidateReplaceNamespace(handoffParentHandle.get(), leafName, targetHandle.get(), observedBefore,
                                          beforeManifest, beforeBytes);
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
      return nullptr;
    }
    // Move the exact observed target away first.  Both renames are create-only: an external
    // replacement in either window is left untouched and the staging namespace records recovery.
    result = renameOpenedFileCreateOnly(targetHandle.get(), handoffParentHandle.get(), recoveryLeaf);
    if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
    if (result == AccessError::kOk) {
      result = renameOpenedFileCreateOnly(stageHandle.get(), handoffParentHandle.get(), leafName);
    }
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    if (!resetFilePointer(stageHandle.get())) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    FileObservation observedAfter{};
    std::string observedAfterBytes;
    result = observeOpenedFile(stageHandle.get(), &observedAfter, &observedAfterBytes);
    if (result == AccessError::kOk &&
        (observedAfterBytes != candidateBytes || !sameManifest(observedAfter.manifest, candidateManifest) ||
         !hasExactLeafName(stageHandle.get(), leafName))) {
      result = AccessError::kPrecondition;
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result == AccessError::kOk) {
      result = deleteRecoveryBeforeFile(targetHandle.get(), recoveryLeaf, observedBefore.identity);
    }
    if (result == AccessError::kOk && !targetHandle.close()) result = AccessError::kRecoveryRequired;
#ifndef ENGINEERING_CANARY_DURABILITY_DISABLED
    if (result == AccessError::kOk && !FlushFileBuffers(handoffParentHandle.get())) result = AccessError::kDurability;
#else
    if (result == AccessError::kOk &&
        !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
#endif
    if (result != AccessError::kOk) {
      throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
      return nullptr;
    }
    napi_value receipt;
    if (!createMutationReceipt(env, "replace", rootId, relativePath, transactionId, operationId, walBinding,
                               &observedBefore, observedAfter, "qualified_basic_metadata", &receipt)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    consumeMutationWalBinding(walBindingId);
    return receipt;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value createFileV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 10;
    napi_value argv[10];
    bool lossless = false;
    uint64_t rootId = 0;
    uint64_t proofId = 0;
    uint64_t walBindingId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 10 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless ||
        napi_get_value_bigint_uint64(env, argv[3], &proofId, &lossless) != napi_ok || !lossless ||
        napi_get_value_bigint_uint64(env, argv[7], &walBindingId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::wstring parentRelativePath;
    std::wstring leafName;
    std::string transactionId;
    std::string operationId;
    std::string stagingId;
    if (!readUtf16String(env, argv[1], kMaxRelativeUtf16Units, &parentRelativePath) ||
        !readUtf16String(env, argv[2], 255, &leafName) || !isCanonicalLeafName(leafName) ||
        isHardDeniedName(leafName) ||
        !readOpaqueIdentifier(env, argv[4], kMaxOpaqueIdentifierUtf8Bytes, &transactionId) ||
        !readOpaqueIdentifier(env, argv[5], kMaxOpaqueIdentifierUtf8Bytes, &operationId) ||
        !readOpaqueIdentifier(env, argv[6], kMaxStagingIdUtf8Bytes, &stagingId)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string candidateBytes;
    BlobManifest candidateManifest{};
    if (!readImmutableBlob(env, argv[8], argv[9], &candidateBytes, &candidateManifest)) {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    MutationWalBinding walBinding{};
    AccessError result = readMutationWalBinding(rootId, walBindingId, transactionId, operationId, stagingId,
                                                &walBinding);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    result = takeAbsenceProof(proofId, rootId, parentRelativePath, leafName, parentIdentity);
    if (result == AccessError::kOk) result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    HANDLE stage = INVALID_HANDLE_VALUE;
    result = createStagingFile(parentHandle.get(), stagingId, &stage);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle stageHandle(stage);
    markMutationStageCreated(walBindingId);
    result = writeAndFlush(stageHandle.get(), candidateBytes);
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result == AccessError::kOk && !parentHandle.close()) result = AccessError::kIo;
    HANDLE handoffParent = INVALID_HANDLE_VALUE;
    if (result == AccessError::kOk) {
      result = openMutationHandoffDirectory(rootId, parentRelativePath, parentIdentity, &handoffParent);
    }
    ScopedHandle handoffParentHandle(handoffParent);
    if (result == AccessError::kOk) result = checkRelativeLeafAbsent(handoffParentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result == AccessError::kOk) {
      result = renameOpenedFileCreateOnly(stageHandle.get(), handoffParentHandle.get(), leafName);
    }
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    if (!resetFilePointer(stageHandle.get())) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    FileObservation observedAfter{};
    std::string observedAfterBytes;
    result = observeOpenedFile(stageHandle.get(), &observedAfter, &observedAfterBytes);
    if (result == AccessError::kOk &&
        (observedAfterBytes != candidateBytes || !sameManifest(observedAfter.manifest, candidateManifest) ||
         !hasExactLeafName(stageHandle.get(), leafName))) {
      result = AccessError::kPrecondition;
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    const std::wstring relativeIdentity =
        parentRelativePath.empty() ? leafName : parentRelativePath + L"/" + leafName;
    napi_value receipt;
    if (!createMutationReceipt(env, "create", rootId, relativeIdentity, transactionId, operationId, walBinding,
                               nullptr, observedAfter, "fixed_windows_metadata", &receipt)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    consumeMutationWalBinding(walBindingId);
    return receipt;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value applyEngineeringFileMutationV2(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
    size_t argc = 5;
    napi_value argv[5];
#else
    size_t argc = 4;
    napi_value argv[4];
#endif
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
        argc != 5 ||
#else
        argc != 4 ||
#endif
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
    std::string faultInjectionPoint;
    if (!readUtf8StringValue(env, argv[4], 32, &faultInjectionPoint) ||
        (faultInjectionPoint != "after_staging_flush" &&
         faultInjectionPoint != "after_original_handoff" &&
         faultInjectionPoint != "after_candidate_handoff")) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
#endif
    V2MutationRequest request{};
    if (!parseV2MutationRequest(env, argv[1], &request)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
    if (request.operationKind != "replace_file") {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
#endif
    std::string beforeBytes;
    napi_valuetype beforeType;
    if (napi_typeof(env, argv[2], &beforeType) != napi_ok ||
        (request.before.present && !readV2Buffer(env, argv[2], &beforeBytes)) ||
        (!request.before.present && beforeType != napi_null)) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    std::string candidateBytes;
    V2RawManifest candidateByteManifest{};
    if (!readV2Buffer(env, argv[3], &candidateBytes) || !v2ManifestForBytes(candidateBytes, &candidateByteManifest) ||
        !sameV2ByteImage(request.candidate.manifest, candidateByteManifest)) {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    std::string requestChecksum;
    if (!v2MutationRequestChecksum(request, &requestChecksum)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    AccessError result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    std::vector<std::wstring> segments;
    if (!parseRelativePath(request.relativePath, false, &segments)) {
      throwAccessError(env, AccessError::kUnsafePath);
      return nullptr;
    }
    const std::wstring leafName = segments.back();
    segments.pop_back();
    std::wstring parentRelativePath;
    for (size_t index = 0; index < segments.size(); ++index) {
      if (index != 0) parentRelativePath.push_back(L'/');
      parentRelativePath += segments[index];
    }
    HANDLE parent = INVALID_HANDLE_VALUE;
    result = openMutationDirectory(rootId, parentRelativePath, &parent);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle parentHandle(parent);
    std::string stageToken;
    if (!v2DeterministicStagingToken(request, &stageToken)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }

    if (request.operationKind == "replace_file") {
      BY_HANDLE_FILE_INFORMATION parentIdentity{};
      if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      HANDLE target = INVALID_HANDLE_VALUE;
      result = openMutationReplaceLeaf(parentHandle.get(), leafName, &target);
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      ScopedHandle targetHandle(target);
      FileObservation beforeObservation{};
      V2RawManifest observedBefore{};
      std::string observedBeforeBytes;
      result = observeOpenedV2File(targetHandle.get(), request.contentRootBindingId, request.relativeIdentity,
                                   &beforeObservation, &observedBefore, &observedBeforeBytes);
      if (result == AccessError::kOk &&
          (observedBeforeBytes != beforeBytes || !sameV2RawManifest(request.before.manifest, observedBefore) ||
           request.candidate.manifest.metadataChecksum != observedBefore.metadataChecksum)) {
        result = AccessError::kPrecondition;
      }
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      HANDLE stage = INVALID_HANDLE_VALUE;
      result = createStagingFile(parentHandle.get(), stageToken, &stage);
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      ScopedHandle stageHandle(stage);
      const std::wstring recoveryLeaf = recoveryStagingLeafName(stageToken);
      result = writeAndFlush(stageHandle.get(), candidateBytes);
      if (result == AccessError::kOk) result = applyQualifiedReplaceMetadata(stageHandle.get(), beforeObservation.basicInfo);
      if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
      if (result == AccessError::kOk && faultInjectionPoint == "after_staging_flush") {
        throwAccessError(env, AccessError::kRecoveryRequired);
        return nullptr;
      }
#endif
      if (result == AccessError::kOk) {
        result = revalidateV2ReplaceNamespace(parentHandle.get(), leafName, targetHandle.get(), beforeObservation,
                                              request.before.manifest, beforeBytes);
      }
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result != AccessError::kOk) {
        throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
        return nullptr;
      }
      if (!parentHandle.close()) {
        throwAccessError(env, AccessError::kIo);
        return nullptr;
      }
      HANDLE handoffParent = INVALID_HANDLE_VALUE;
      result = openMutationHandoffDirectory(rootId, parentRelativePath, parentIdentity, &handoffParent);
      ScopedHandle handoffParentHandle(handoffParent);
      if (result == AccessError::kOk) {
        result = revalidateV2ReplaceNamespace(handoffParentHandle.get(), leafName, targetHandle.get(), beforeObservation,
                                              request.before.manifest, beforeBytes);
      }
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result != AccessError::kOk) {
        throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
        return nullptr;
      }
      // Rename the verified original by handle before installing the candidate.  Neither rename
      // permits replacement, so a final-window target swap wins over this mutation rather than
      // being silently overwritten.
      result = renameOpenedFileCreateOnly(targetHandle.get(), handoffParentHandle.get(), recoveryLeaf);
      if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
      if (result == AccessError::kOk && faultInjectionPoint == "after_original_handoff") {
        throwAccessError(env, AccessError::kRecoveryRequired);
        return nullptr;
      }
#endif
      if (result == AccessError::kOk) {
        result = renameOpenedFileCreateOnly(stageHandle.get(), handoffParentHandle.get(), leafName);
      }
      if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
      if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
      if (result == AccessError::kOk && faultInjectionPoint == "after_candidate_handoff") {
        throwAccessError(env, AccessError::kRecoveryRequired);
        return nullptr;
      }
#endif
      if (result != AccessError::kOk) {
        throwAccessError(env, result);
        return nullptr;
      }
      if (!resetFilePointer(stageHandle.get())) {
        throwAccessError(env, AccessError::kRecoveryRequired);
        return nullptr;
      }
      FileObservation afterObservation{};
      V2RawManifest observedAfter{};
      std::string observedAfterBytes;
      result = observeOpenedV2File(stageHandle.get(), request.contentRootBindingId, request.relativeIdentity,
                                   &afterObservation, &observedAfter, &observedAfterBytes);
      if (result == AccessError::kOk &&
          (observedAfterBytes != candidateBytes || !sameV2CandidateAfter(request.candidate.manifest, observedAfter) ||
           !hasExactLeafName(stageHandle.get(), leafName))) {
        result = AccessError::kRecoveryRequired;
      }
      if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
      if (result == AccessError::kOk) {
        result = deleteRecoveryBeforeFile(targetHandle.get(), recoveryLeaf, beforeObservation.identity);
      }
      if (result == AccessError::kOk && !targetHandle.close()) result = AccessError::kRecoveryRequired;
#ifndef ENGINEERING_CANARY_DURABILITY_DISABLED
      if (result == AccessError::kOk && !FlushFileBuffers(handoffParentHandle.get())) result = AccessError::kDurability;
#else
      if (result == AccessError::kOk &&
          !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
#endif
      if (result != AccessError::kOk) {
        throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
        return nullptr;
      }
      napi_value receipt;
      if (!createV2MutationReceipt(env, request, requestChecksum, observedAfter, &receipt)) {
        throwAccessError(env, AccessError::kRecoveryRequired);
        return nullptr;
      }
      return receipt;
    }

    BY_HANDLE_FILE_INFORMATION parentIdentity{};
    if (!GetFileInformationByHandle(parentHandle.get(), &parentIdentity)) {
      throwAccessError(env, AccessError::kIo);
      return nullptr;
    }
    std::string expectedCreateMetadata;
    if (!v2MetadataChecksumForAttributes(FILE_ATTRIBUTE_NORMAL, &expectedCreateMetadata) ||
        request.before.absenceProof.parentDirectoryIdentity != v2ParentDirectoryIdentity(parentIdentity) ||
        request.candidate.manifest.metadataChecksum != expectedCreateMetadata) {
      throwAccessError(env, AccessError::kPrecondition);
      return nullptr;
    }
    result = checkRelativeLeafAbsent(parentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    HANDLE stage = INVALID_HANDLE_VALUE;
    result = createStagingFile(parentHandle.get(), stageToken, &stage);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    ScopedHandle stageHandle(stage);
    result = writeAndFlush(stageHandle.get(), candidateBytes);
    if (result == AccessError::kOk) result = applyFixedCreateMetadataV2(stageHandle.get());
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk && !parentHandle.close()) result = AccessError::kIo;
    HANDLE handoffParent = INVALID_HANDLE_VALUE;
    if (result == AccessError::kOk) {
      result = openMutationHandoffDirectory(rootId, parentRelativePath, parentIdentity, &handoffParent);
    }
    ScopedHandle handoffParentHandle(handoffParent);
    if (result == AccessError::kOk) result = checkRelativeLeafAbsent(handoffParentHandle.get(), leafName);
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
      return nullptr;
    }
    result = renameOpenedFileCreateOnly(stageHandle.get(), handoffParentHandle.get(), leafName);
    if (result == AccessError::kOk && !flushDurably(stageHandle.get(), DurableFlushKind::kData)) result = AccessError::kDurability;
    if (result == AccessError::kOk && !flushDurably(handoffParentHandle.get(), DurableFlushKind::kDirectory)) result = AccessError::kDurability;
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    if (!resetFilePointer(stageHandle.get())) {
      throwAccessError(env, AccessError::kRecoveryRequired);
      return nullptr;
    }
    FileObservation afterObservation{};
    V2RawManifest observedAfter{};
    std::string observedAfterBytes;
    result = observeOpenedV2File(stageHandle.get(), request.contentRootBindingId, request.relativeIdentity,
                                 &afterObservation, &observedAfter, &observedAfterBytes);
    if (result == AccessError::kOk &&
        (observedAfterBytes != candidateBytes || !sameV2CandidateAfter(request.candidate.manifest, observedAfter) ||
         !hasExactLeafName(stageHandle.get(), leafName))) {
      result = AccessError::kRecoveryRequired;
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result == AccessError::kPrecondition ? AccessError::kRecoveryRequired : result);
      return nullptr;
    }
    napi_value receipt;
    if (!createV2MutationReceipt(env, request, requestChecksum, observedAfter, &receipt)) {
      throwAccessError(env, AccessError::kRecoveryRequired);
      return nullptr;
    }
    return receipt;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

napi_value scanMutationRecovery(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  try {
    size_t argc = 1;
    napi_value argv[1];
    bool lossless = false;
    uint64_t rootId = 0;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
        napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok || !lossless) {
      throwAccessError(env, AccessError::kInvalidArgument);
      return nullptr;
    }
    ScanBudget budget;
    uint64_t pendingStaging = 0;
    bool truncated = false;
    AccessError result = collectPendingStaging(rootId, L"", 0, &budget, &pendingStaging, &truncated);
    if (result == AccessError::kScanLimit) {
      truncated = true;
      result = AccessError::kOk;
    }
    if (result == AccessError::kOk) result = verifyRootStillCurrent(rootId);
    if (result != AccessError::kOk) {
      throwAccessError(env, result);
      return nullptr;
    }
    const uint64_t pendingWal = pendingMutationWalBindings(rootId);
    const bool recoveryRequired = truncated || pendingStaging != 0 || pendingWal != 0;
    napi_value output;
    napi_value state;
    napi_value stagingCount;
    napi_value walCount;
    napi_value truncatedValue;
    napi_value scope;
    napi_value durability;
    napi_create_object(env, &output);
    napi_create_string_utf8(env, recoveryRequired ? "recovery_required" : "clear", NAPI_AUTO_LENGTH, &state);
    napi_create_bigint_uint64(env, pendingStaging, &stagingCount);
    napi_create_bigint_uint64(env, pendingWal, &walCount);
    napi_get_boolean(env, truncated, &truncatedValue);
    napi_create_string_utf8(env, "native_staging_and_in_process_wal_only", NAPI_AUTO_LENGTH, &scope);
    napi_create_string_utf8(env, "external_durable_wal_scan_required", NAPI_AUTO_LENGTH, &durability);
    napi_set_named_property(env, output, "state", state);
    napi_set_named_property(env, output, "pendingStagingCount", stagingCount);
    napi_set_named_property(env, output, "inProcessPendingWalCount", walCount);
    napi_set_named_property(env, output, "scanTruncated", truncatedValue);
    napi_set_named_property(env, output, "scanScope", scope);
    napi_set_named_property(env, output, "durableWalRequirement", durability);
    return output;
  } catch (const std::bad_alloc&) {
    throwAccessError(env, AccessError::kResourceLimit);
    return nullptr;
  } catch (...) {
    throwAccessError(env, AccessError::kIo);
    return nullptr;
  }
#else
  (void)info;
  throwAccessError(env, AccessError::kUnavailable);
  return nullptr;
#endif
}

#ifdef ENGINEERING_DISABLED_PROTECTION_CANARY_BUILD
const char* disabledProtectionCanaryName() {
#if defined(ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED)
  return "rootRelativeDisabled";
#elif defined(ENGINEERING_CANARY_NO_FOLLOW_DISABLED)
  return "noFollowDisabled";
#elif defined(ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED)
  return "rawByteIdentityDisabled";
#elif defined(ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED)
  return "receiptBindingDisabled";
#elif defined(ENGINEERING_CANARY_DURABILITY_DISABLED)
  return "durabilityDisabled";
#elif defined(ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED)
  return "recoveryRootBindingDisabled";
#else
#error "disabled-protection canary build is missing its fixed protection name"
#endif
}

napi_value disabledProtectionCanaryInfo(napi_env env, napi_callback_info) {
  napi_value output;
  napi_value dataFlushes;
  napi_value directoryFlushes;
  napi_create_object(env, &output);
  napi_create_bigint_uint64(
      env,
#ifdef ENGINEERING_CANARY_DURABILITY_DISABLED
      g_bypassedDataFlushes.load(),
#else
      0,
#endif
      &dataFlushes);
  napi_create_bigint_uint64(
      env,
#ifdef ENGINEERING_CANARY_DURABILITY_DISABLED
      g_bypassedDirectoryFlushes.load(),
#else
      0,
#endif
      &directoryFlushes);
  napi_set_named_property(env, output, "schemaVersion", makeString(env, "engineering_disabled_protection_canary_v1"));
  napi_set_named_property(env, output, "buildKind", makeString(env, "test_only_compile_time_variant"));
  napi_set_named_property(env, output, "disabledProtection", makeString(env, disabledProtectionCanaryName()));
  napi_set_named_property(env, output, "bypassedDataFlushes", dataFlushes);
  napi_set_named_property(env, output, "bypassedDirectoryFlushes", directoryFlushes);
  return output;
}
#endif

#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
napi_value mutationFaultInjectionInfo(napi_env env, napi_callback_info) {
  napi_value output;
  napi_value faultPoints;
  napi_create_object(env, &output);
  napi_create_array_with_length(env, 3, &faultPoints);
  napi_set_element(env, faultPoints, 0, makeString(env, "after_staging_flush"));
  napi_set_element(env, faultPoints, 1, makeString(env, "after_original_handoff"));
  napi_set_element(env, faultPoints, 2, makeString(env, "after_candidate_handoff"));
  napi_set_named_property(env, output, "schemaVersion",
                          makeString(env, "engineering_mutation_fault_injection_v1"));
  napi_set_named_property(env, output, "buildKind",
                          makeString(env, "test_only_compile_time_diagnostic"));
  napi_set_named_property(env, output, "faultPoints", faultPoints);
  return output;
}
#endif

napi_value mutationV2FaultProbe(napi_env env, napi_callback_info) {
  napi_value output;
  napi_value status;
  napi_value safety;
  napi_value paths;
  napi_create_object(env, &output);
#ifdef _WIN32
  napi_create_string_utf8(env, "available", NAPI_AUTO_LENGTH, &status);
  napi_create_string_utf8(env, "invalid_inputs_only_no_protection_switches", NAPI_AUTO_LENGTH, &safety);
  napi_create_array_with_length(env, 10, &paths);
  napi_set_element(env, paths, 0, makeString(env, "raw_byte_manifest_mismatch"));
  napi_set_element(env, paths, 1, makeString(env, "stale_absence_proof"));
  napi_set_element(env, paths, 2, makeString(env, "wal_binding_mismatch"));
  napi_set_element(env, paths, 3, makeString(env, "post_stage_recovery_scan"));
  napi_set_element(env, paths, 4, makeString(env, "replace_final_rename_namespace_revalidation"));
  napi_set_element(env, paths, 5, makeString(env, "replace_handle_bound_target_swap_no_overwrite"));
  napi_set_element(env, paths, 6, makeString(env, "replace_create_only_handoff_collision_recovery"));
  napi_set_element(env, paths, 7, makeString(env, "replace_after_original_handoff_recovery"));
  napi_set_element(env, paths, 8, makeString(env, "replace_before_candidate_handoff_recovery"));
  napi_set_element(env, paths, 9, makeString(env, "replace_after_candidate_handoff_recovery"));
#else
  napi_create_string_utf8(env, "unsupported", NAPI_AUTO_LENGTH, &status);
  napi_create_string_utf8(env, "not_available", NAPI_AUTO_LENGTH, &safety);
  napi_create_array(env, &paths);
#endif
  napi_set_named_property(env, output, "status", status);
  napi_set_named_property(env, output, "safety", safety);
  napi_set_named_property(env, output, "faultPaths", paths);
  return output;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"adapterInfo", nullptr, adapterInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openWorkspaceRoot", nullptr, openWorkspaceRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeWorkspaceRoot", nullptr, closeWorkspaceRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"listDirectory", nullptr, listDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readFile", nullptr, readFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"searchText", nullptr, searchText, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"buildIndex", nullptr, buildIndex, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openEngineeringStateRoot", nullptr, openEngineeringStateRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeEngineeringStateRoot", nullptr, closeEngineeringStateRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"ensureEngineeringStateDirectoryNoFollow", nullptr, ensureEngineeringStateDirectoryNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"flushEngineeringStateDirectory", nullptr, flushEngineeringStateDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openEngineeringStateExclusiveNoFollow", nullptr, openEngineeringStateExclusiveNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"writeEngineeringStateFile", nullptr, writeEngineeringStateFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"syncEngineeringStateFile", nullptr, syncEngineeringStateFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeEngineeringStateFile", nullptr, closeEngineeringStateFile, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readEngineeringStateFileNoFollow", nullptr, readEngineeringStateFileNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readEngineeringStateDirectoryNoFollow", nullptr, readEngineeringStateDirectoryNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"linkEngineeringStateFileNoFollow", nullptr, linkEngineeringStateFileNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"renameReplaceEngineeringStateFileNoFollow", nullptr, renameReplaceEngineeringStateFileNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"unlinkEngineeringStateFileNoFollow", nullptr, unlinkEngineeringStateFileNoFollow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"mutationV2ProbeInfo", nullptr, mutationV2ProbeInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspectEngineeringFileSnapshotV2", nullptr, inspectEngineeringFileSnapshotV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspectEngineeringFileMutationTargetV2", nullptr, inspectEngineeringFileMutationTargetV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"observeCreateAbsenceV2", nullptr, observeCreateAbsenceV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"applyEngineeringFileMutationV2", nullptr, applyEngineeringFileMutationV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"prepareMutationWalV2", nullptr, prepareMutationWalV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"observeCreateAbsence", nullptr, observeCreateAbsence, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"replaceFileV2", nullptr, replaceFileV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"createFileV2", nullptr, createFileV2, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"scanMutationRecovery", nullptr, scanMutationRecovery, nullptr, nullptr, nullptr, napi_default, nullptr},
#ifdef ENGINEERING_DISABLED_PROTECTION_CANARY_BUILD
    {"disabledProtectionCanaryInfo", nullptr, disabledProtectionCanaryInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
#endif
#ifdef ENGINEERING_MUTATION_FAULT_INJECTION_BUILD
    {"mutationFaultInjectionInfo", nullptr, mutationFaultInjectionInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
#endif
    {"mutationV2FaultProbe", nullptr, mutationV2FaultProbe, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
#ifdef _WIN32
  napi_add_env_cleanup_hook(env, [](void*) { closeRoots(); }, nullptr);
#endif
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
