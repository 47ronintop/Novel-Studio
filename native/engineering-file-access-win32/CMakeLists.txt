cmake_minimum_required(VERSION 3.24)
project(engineering_file_access_win32 LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "engineering-file-access-win32 requires win32-x64")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(NODE_API_INCLUDE_DIR "" CACHE PATH "Directory containing node_api.h")
set(NODE_LIBRARY "" CACHE FILEPATH "Path to the Node-API import library for the Node runtime used to load the addon")
if(NOT NODE_API_INCLUDE_DIR)
  message(FATAL_ERROR "NODE_API_INCLUDE_DIR is required; use the CI-provided Node-API headers")
endif()
if(NOT NODE_LIBRARY)
  message(FATAL_ERROR "NODE_LIBRARY is required; use the CI-provided Node-API import library")
endif()

function(configure_engineering_file_access_target target output_name)
  set_property(
    TARGET ${target}
    PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  )
  target_include_directories(${target} PRIVATE "${NODE_API_INCLUDE_DIR}")
  target_link_libraries(${target} PRIVATE "${NODE_LIBRARY}" normaliz bcrypt)
  target_compile_definitions(${target} PRIVATE NAPI_VERSION=8 NODE_GYP_MODULE_NAME=engineering_file_access)
  set_target_properties(${target} PROPERTIES PREFIX "" SUFFIX ".node" OUTPUT_NAME "${output_name}")
  target_compile_options(${target} PRIVATE /W4 /WX /Brepro)
  target_link_options(${target} PRIVATE /Brepro)
endfunction()

add_library(engineering_file_access MODULE src/engineering_file_access.cc)
configure_engineering_file_access_target(engineering_file_access engineering_file_access)

# These targets are negative controls, not alternate production hosts. They compile the canonical
# source once per protection with a single fixed weakening and remain outside the default build.
option(ENGINEERING_BUILD_DISABLED_PROTECTION_CANARIES
       "Build test-only disabled-protection negative controls" OFF)
if(ENGINEERING_BUILD_DISABLED_PROTECTION_CANARIES)
  set(canary_targets
      engineering_file_access_root_relative_disabled
      engineering_file_access_no_follow_disabled
      engineering_file_access_raw_byte_identity_disabled
      engineering_file_access_receipt_binding_disabled
      engineering_file_access_durability_disabled
      engineering_file_access_recovery_root_binding_disabled)
  foreach(target IN LISTS canary_targets)
    add_library(${target} MODULE EXCLUDE_FROM_ALL src/engineering_file_access.cc)
    configure_engineering_file_access_target(${target} ${target})
  endforeach()
  add_library(engineering_file_access_mutation_fault_injection MODULE EXCLUDE_FROM_ALL
              src/engineering_file_access.cc)
  configure_engineering_file_access_target(engineering_file_access_mutation_fault_injection
                                           engineering_file_access_mutation_fault_injection)
  target_compile_definitions(engineering_file_access_mutation_fault_injection
                             PRIVATE ENGINEERING_MUTATION_FAULT_INJECTION_BUILD=1)
  target_compile_definitions(engineering_file_access_root_relative_disabled
                             PRIVATE ENGINEERING_CANARY_ROOT_RELATIVE_DISABLED=1)
  target_compile_definitions(engineering_file_access_no_follow_disabled
                             PRIVATE ENGINEERING_CANARY_NO_FOLLOW_DISABLED=1)
  target_compile_definitions(engineering_file_access_raw_byte_identity_disabled
                             PRIVATE ENGINEERING_CANARY_RAW_BYTE_IDENTITY_DISABLED=1)
  target_compile_definitions(engineering_file_access_receipt_binding_disabled
                             PRIVATE ENGINEERING_CANARY_RECEIPT_BINDING_DISABLED=1)
  target_compile_definitions(engineering_file_access_durability_disabled
                             PRIVATE ENGINEERING_CANARY_DURABILITY_DISABLED=1)
  target_compile_definitions(engineering_file_access_recovery_root_binding_disabled
                             PRIVATE ENGINEERING_CANARY_RECOVERY_ROOT_BINDING_DISABLED=1)
endif()
