// Berean — macOS iCloud container access for the Mac App Store (sandboxed) build.
//
// Why this exists (docs/mac-app-store.md §3): the sync store is a plain folder inside the iCloud
// Drive ubiquity container. The Developer ID (DMG) build is not sandboxed and reaches it at
// ~/Library/Mobile Documents/iCloud~com~berean~app. A sandboxed app cannot: its home directory is
// its own container, and the system only extends the sandbox to the ubiquity container once the
// process calls -[NSFileManager URLForUbiquityContainerIdentifier:]. Evicted files must likewise
// be requested through -startDownloadingUbiquitousItemAtURL:error: (the sandbox cannot run brctl).
//
// Plain Node-API (ABI-stable, no Electron headers): built by scripts/mac/build-native.mjs with
// clang, loaded only when process.mas is true (electron/sync/macContainer.ts).

#import <Foundation/Foundation.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *identifier; // NULL → the first container in the entitlements
  char *path;       // result, NULL when iCloud is unavailable (signed out, no entitlement)
} ContainerJob;

static char *copy_string_arg(napi_env env, napi_value value) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &len) != napi_ok) return NULL;
  char *buf = malloc(len + 1);
  if (!buf) return NULL;
  napi_get_value_string_utf8(env, value, buf, len + 1, &len);
  return buf;
}

// Worker thread: Apple asks callers not to run this on the main thread (it can block while the
// container is being set up).
static void container_execute(napi_env env, void *data) {
  ContainerJob *job = data;
  @autoreleasepool {
    NSString *identifier = job->identifier ? [NSString stringWithUTF8String:job->identifier] : nil;
    NSURL *url = [[NSFileManager defaultManager] URLForUbiquityContainerIdentifier:identifier];
    if (url && url.path) job->path = strdup(url.path.fileSystemRepresentation);
  }
}

static void container_complete(napi_env env, napi_status status, void *data) {
  ContainerJob *job = data;
  napi_value result;
  if (job->path) napi_create_string_utf8(env, job->path, NAPI_AUTO_LENGTH, &result);
  else napi_get_null(env, &result);
  napi_resolve_deferred(env, job->deferred, result);
  napi_delete_async_work(env, job->work);
  free(job->identifier);
  free(job->path);
  free(job);
}

// containerPath(identifier?: string): Promise<string | null>
static napi_value container_path(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  ContainerJob *job = calloc(1, sizeof(ContainerJob));
  if (argc >= 1) {
    napi_valuetype t;
    napi_typeof(env, argv[0], &t);
    if (t == napi_string) job->identifier = copy_string_arg(env, argv[0]);
  }
  napi_value promise, name;
  napi_create_promise(env, &job->deferred, &promise);
  napi_create_string_utf8(env, "bereanContainerPath", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, container_execute, container_complete, job, &job->work);
  napi_queue_async_work(env, job->work);
  return promise;
}

// startDownloading(path: string): boolean — asks iCloud to materialise an evicted file.
static napi_value start_downloading(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  bool ok = false;
  if (argc >= 1) {
    char *path = copy_string_arg(env, argv[0]);
    if (path) {
      @autoreleasepool {
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
        ok = [[NSFileManager defaultManager] startDownloadingUbiquitousItemAtURL:url error:nil];
      }
      free(path);
    }
  }
  napi_value result;
  napi_get_boolean(env, ok, &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "containerPath", NULL, container_path, NULL, NULL, NULL, napi_enumerable, NULL },
    { "startDownloading", NULL, start_downloading, NULL, NULL, NULL, napi_enumerable, NULL },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(berean_icloud, init)
