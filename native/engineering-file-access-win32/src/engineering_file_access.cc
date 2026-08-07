#include <node_api.h>

#ifdef _WIN32
#include <windows.h>
#include <fileapi.h>
#include <string>
#include <vector>
#include <mutex>
#include <unordered_map>
#include <atomic>
#endif

namespace {

#ifdef _WIN32
std::mutex g_rootsMutex;
std::unordered_map<uint64_t, HANDLE> g_roots;
std::atomic<uint64_t> g_nextRoot{1};

void closeRoots() {
  std::scoped_lock lock(g_rootsMutex);
  for (const auto& [id, handle] : g_roots) {
    (void)id;
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
  }
  g_roots.clear();
}

bool isSafeRelativePath(const std::wstring& path) {
  if (path.empty() || path.front() == L'\\' || path.front() == L'/') return false;
  if (path.find(L':') != std::wstring::npos || path.find(L"\\\\") != std::wstring::npos) return false;
  size_t start = 0;
  while (start < path.size()) {
    const size_t end = path.find_first_of(L"\\/", start);
    const std::wstring segment = path.substr(start, end == std::wstring::npos ? end : end - start);
    if (segment.empty() || segment == L"." || segment == L"..") return false;
    start = end == std::wstring::npos ? path.size() : end + 1;
  }
  return true;
}

bool readUtf16String(napi_env env, napi_value value, std::wstring* output) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::vector<char16_t> buffer(length + 1, u'\0');
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) {
    return false;
  }
  output->assign(buffer.begin(), buffer.begin() + length);
  return true;
}

bool readUtf8File(uint64_t rootId, const std::wstring& relative, std::string* output) {
  if (!isSafeRelativePath(relative)) return false;
  std::scoped_lock lock(g_rootsMutex);
  const auto root = g_roots.find(rootId);
  if (root == g_roots.end()) return false;

  // There is deliberately no pathname fallback. Until the root-relative handle primitive is
  // implemented and qualified, this B6 development addon fails every read closed.
  (void)relative;
  (void)output;
  return false;
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
  // The source-stream scaffold only opens and retains a root handle.  Relative
  // access/read/index traversal is not implemented or qualified yet, so the
  // addon must not advertise those capabilities to a Main loader or probe.
  napi_set_named_property(env, result, "accessEligible", makeString(env, "unavailable"));
  napi_set_named_property(env, result, "mutation", makeString(env, "unavailable"));
  napi_set_named_property(env, result, "recovery", makeString(env, "unavailable"));
  return result;
}

napi_value openWorkspaceRoot(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return nullptr;
  std::wstring wide;
  if (!readUtf16String(env, argv[0], &wide)) return nullptr;
  HANDLE handle = CreateFileW(wide.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return nullptr;
  BY_HANDLE_FILE_INFORMATION infoData{};
  if (!GetFileInformationByHandle(handle, &infoData) ||
      (infoData.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != FILE_ATTRIBUTE_DIRECTORY) {
    CloseHandle(handle);
    return nullptr;
  }
  const uint64_t rootId = g_nextRoot.fetch_add(1);
  {
    std::scoped_lock lock(g_rootsMutex);
    g_roots.emplace(rootId, handle);
  }
  napi_value result;
  napi_create_object(env, &result);
  napi_value id;
  napi_create_bigint_uint64(env, rootId, &id);
  napi_set_named_property(env, result, "rootId", id);
  napi_set_named_property(env, result, "capability", makeString(env, "unavailable"));
  return result;
#else
  (void)env;
  (void)info;
  return nullptr;
#endif
}

napi_value readFile(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) return nullptr;
  bool lossless = false;
  uint64_t rootId = 0;
  if (napi_get_value_bigint_uint64(env, argv[0], &rootId, &lossless) != napi_ok) return nullptr;
  std::wstring path;
  if (!readUtf16String(env, argv[1], &path)) return nullptr;
  std::string output;
  if (!lossless || !readUtf8File(rootId, path, &output)) return nullptr;
  napi_value result;
  napi_create_buffer_copy(env, output.size(), output.data(), nullptr, &result);
  return result;
#else
  (void)env;
  (void)info;
  return nullptr;
#endif
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"adapterInfo", nullptr, adapterInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openWorkspaceRoot", nullptr, openWorkspaceRoot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readFile", nullptr, readFile, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
#ifdef _WIN32
  napi_add_env_cleanup_hook(env, [](void*) { closeRoots(); }, nullptr);
#endif
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
