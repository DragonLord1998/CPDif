cmake_minimum_required(VERSION 3.21)

project(CPDif VERSION 0.1.0 LANGUAGES C CXX)

include(GNUInstallDirs)

option(CPDIF_ENABLE_CUDA "Build the CUDA backend" OFF)
option(CPDIF_OFFLINE "Build the CLI and validation layer without fetching the inference backend" OFF)
option(CPDIF_BUILD_TESTS "Build and register tests" ON)
set(CPDIF_CUDA_ARCHITECTURES "80" CACHE STRING "CUDA architectures used by the native backend")
set(CPDIF_SDCXX_SOURCE_DIR "" CACHE PATH "Optional existing stable-diffusion.cpp checkout")
set(
  CPDIF_SDCXX_GIT_TAG
  "e31a86ce9110b11a98bd5990c329093244c2d1e3"
  CACHE STRING
  "Pinned stable-diffusion.cpp revision"
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

add_library(cpdif_core STATIC
  src/config.cpp
)
target_include_directories(cpdif_core PUBLIC include)
target_compile_features(cpdif_core PUBLIC cxx_std_17)

if(MSVC)
  target_compile_options(cpdif_core PRIVATE /W4)
else()
  target_compile_options(cpdif_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

set(CPDIF_ENGINE_SOURCES src/engine_stub.cpp)
set(CPDIF_HAS_NATIVE_BACKEND OFF)

if(NOT CPDIF_OFFLINE)
  set(SD_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(SD_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(SD_BUILD_SHARED_GGML_LIB OFF CACHE BOOL "" FORCE)
  set(SD_WEBP OFF CACHE BOOL "" FORCE)
  set(SD_WEBM OFF CACHE BOOL "" FORCE)
  set(SD_CUDA ${CPDIF_ENABLE_CUDA} CACHE BOOL "" FORCE)

  if(CPDIF_ENABLE_CUDA)
    set(CMAKE_CUDA_ARCHITECTURES "${CPDIF_CUDA_ARCHITECTURES}" CACHE STRING "" FORCE)
  endif()

  if(CPDIF_SDCXX_SOURCE_DIR)
    if(NOT EXISTS "${CPDIF_SDCXX_SOURCE_DIR}/CMakeLists.txt")
      message(FATAL_ERROR "CPDIF_SDCXX_SOURCE_DIR does not contain stable-diffusion.cpp")
    endif()
    set(stable_diffusion_SOURCE_DIR "${CPDIF_SDCXX_SOURCE_DIR}")
    add_subdirectory("${CPDIF_SDCXX_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/_deps/stable-diffusion-build")
  else()
    include(FetchContent)
    FetchContent_Declare(
      stable_diffusion
      GIT_REPOSITORY https://github.com/leejet/stable-diffusion.cpp.git
      GIT_TAG "${CPDIF_SDCXX_GIT_TAG}"
      GIT_SUBMODULES ggml
      GIT_SUBMODULES_RECURSE TRUE
    )
    FetchContent_MakeAvailable(stable_diffusion)
  endif()

  set(CPDIF_ENGINE_SOURCES
    src/engine_sdcpp.cpp
    src/image_writer.cpp
  )
  set(CPDIF_HAS_NATIVE_BACKEND ON)
endif()

add_executable(cpdif
  src/main.cpp
  ${CPDIF_ENGINE_SOURCES}
)
target_link_libraries(cpdif PRIVATE cpdif_core)
target_include_directories(cpdif PRIVATE src)
target_compile_definitions(cpdif PRIVATE CPDIF_VERSION="${PROJECT_VERSION}")

if(CPDIF_HAS_NATIVE_BACKEND)
  target_link_libraries(cpdif PRIVATE stable-diffusion)
  target_include_directories(cpdif PRIVATE "${stable_diffusion_SOURCE_DIR}/thirdparty")
  target_compile_definitions(cpdif PRIVATE CPDIF_HAS_NATIVE_BACKEND=1)
else()
  target_compile_definitions(cpdif PRIVATE CPDIF_HAS_NATIVE_BACKEND=0)
endif()

if(MSVC)
  target_compile_options(cpdif PRIVATE /W4)
else()
  target_compile_options(cpdif PRIVATE -Wall -Wextra -Wpedantic)
endif()

install(TARGETS cpdif RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

if(CPDIF_BUILD_TESTS)
  enable_testing()
  add_executable(cpdif_config_tests tests/native/test_config.cpp)
  target_link_libraries(cpdif_config_tests PRIVATE cpdif_core)
  add_test(NAME cpdif_config_tests COMMAND cpdif_config_tests)
  add_test(NAME cpdif_help COMMAND cpdif --help)
  add_test(NAME cpdif_backend_status COMMAND cpdif backend)
endif()
