if(NOT DEFINED SOURCE_DIR OR NOT EXISTS "${SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "SOURCE_DIR must point to stable-diffusion.cpp")
endif()
if(NOT DEFINED PATCH_FILE OR NOT EXISTS "${PATCH_FILE}")
  message(FATAL_ERROR "PATCH_FILE is missing: ${PATCH_FILE}")
endif()

find_program(GIT_EXECUTABLE git REQUIRED)

execute_process(
  COMMAND "${GIT_EXECUTABLE}" apply --reverse --check "${PATCH_FILE}"
  WORKING_DIRECTORY "${SOURCE_DIR}"
  RESULT_VARIABLE PATCH_ALREADY_APPLIED
  OUTPUT_QUIET
  ERROR_QUIET
)
if(PATCH_ALREADY_APPLIED EQUAL 0)
  message(STATUS "CPDif stable-diffusion.cpp patch is already applied")
  return()
endif()

execute_process(
  COMMAND "${GIT_EXECUTABLE}" apply --check "${PATCH_FILE}"
  WORKING_DIRECTORY "${SOURCE_DIR}"
  RESULT_VARIABLE PATCH_CHECK_RESULT
  OUTPUT_VARIABLE PATCH_CHECK_OUTPUT
  ERROR_VARIABLE PATCH_CHECK_ERROR
)
if(NOT PATCH_CHECK_RESULT EQUAL 0)
  message(FATAL_ERROR
    "The pinned stable-diffusion.cpp source does not accept the CPDif patch.\n"
    "${PATCH_CHECK_OUTPUT}${PATCH_CHECK_ERROR}"
  )
endif()

execute_process(
  COMMAND "${GIT_EXECUTABLE}" apply "${PATCH_FILE}"
  WORKING_DIRECTORY "${SOURCE_DIR}"
  RESULT_VARIABLE PATCH_APPLY_RESULT
  OUTPUT_VARIABLE PATCH_APPLY_OUTPUT
  ERROR_VARIABLE PATCH_APPLY_ERROR
)
if(NOT PATCH_APPLY_RESULT EQUAL 0)
  message(FATAL_ERROR
    "Failed to apply the CPDif stable-diffusion.cpp patch.\n"
    "${PATCH_APPLY_OUTPUT}${PATCH_APPLY_ERROR}"
  )
endif()

message(STATUS "Applied CPDif FLUX.2 klein KV-cache patch")
