// Berean — native macOS Liquid Glass bridge (public AppKit only).
//
// The React UI asks for semantic glass (src/platform/liquidGlass); on macOS the main process maps
// that onto real AppKit views through this module:
//
//   NSGlassEffectView           (macOS 26+)  one glass surface: style, cornerRadius, tintColor,
//                                            effectIsInteractive (macOS 27+)
//   NSGlassEffectContainerView  (macOS 26+)  a group — member surfaces merge/blend by `spacing`
//   NSVisualEffectView          (older macOS) the fallback material for the same surface
//
// Placement. Berean's controls and content live in ONE Chromium view, and glass only shows what
// is behind it, so a surface is placed BEHIND the web view: the page leaves that region
// transparent and draws its own (crisp) controls on top. Input therefore never reaches native
// views — the web view keeps every click, key, scroll, drag and VoiceOver focus, and z-order
// against React menus/popovers is unchanged. (A glass view ABOVE the web view would blur the very
// React controls it sits under; it is only correct for native controls, e.g. an NSToolbar.)
//
// Lifecycle. Every surface/group belongs to one window (keyed by the window's content view); the
// main process destroys a window's surfaces on 'closed', and views are released with ARC.
//
// Plain Node-API (ABI-stable, no Electron headers): built by scripts/mac/build-native.mjs, loaded
// by electron/liquidGlass.ts. Every entry point runs on the main (AppKit) thread.

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

static NSMutableDictionary<NSString *, NSView *> *gSurfaces;   // "win:id" → glass / effect view
static NSMutableDictionary<NSString *, NSView *> *gGroups;     // "win:id" → container view
static NSMutableDictionary<NSString *, NSString *> *gSurfaceGroup; // surface key → group key

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
static NSString *str_arg(napi_env env, napi_value v) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, NULL, 0, &len) != napi_ok) return nil;
  char *buf = malloc(len + 1);
  napi_get_value_string_utf8(env, v, buf, len + 1, &len);
  NSString *s = [NSString stringWithUTF8String:buf];
  free(buf);
  return s;
}

static napi_value make_str(napi_env env, NSString *s) {
  napi_value out;
  napi_create_string_utf8(env, s ? s.UTF8String : "", NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value make_bool(napi_env env, BOOL b) {
  napi_value out;
  napi_get_boolean(env, b, &out);
  return out;
}

// getNativeWindowHandle() → Buffer holding an NSView* (the window's content view).
static NSView *view_arg(napi_env env, napi_value v) {
  void *data = NULL;
  size_t len = 0;
  if (napi_get_buffer_info(env, v, &data, &len) != napi_ok || len < sizeof(void *)) return nil;
  void *ptr = *(void **)data;
  if (!ptr) return nil;
  return (__bridge NSView *)ptr;
}

static NSDictionary *json_arg(napi_env env, napi_value v) {
  NSString *s = str_arg(env, v);
  if (!s) return nil;
  id obj = [NSJSONSerialization JSONObjectWithData:[s dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  return [obj isKindOfClass:[NSDictionary class]] ? obj : nil;
}

static NSColor *color_from_hex(NSString *hex) {
  if (![hex isKindOfClass:[NSString class]] || ![hex hasPrefix:@"#"]) return nil;
  unsigned long long v = 0;
  NSString *h = [hex substringFromIndex:1];
  if (h.length != 6 && h.length != 8) return nil;
  [[NSScanner scannerWithString:h] scanHexLongLong:&v];
  CGFloat r, g, b, a = 1;
  if (h.length == 8) { r = ((v >> 24) & 0xff) / 255.0; g = ((v >> 16) & 0xff) / 255.0; b = ((v >> 8) & 0xff) / 255.0; a = (v & 0xff) / 255.0; }
  else { r = ((v >> 16) & 0xff) / 255.0; g = ((v >> 8) & 0xff) / 255.0; b = (v & 0xff) / 255.0; }
  return [NSColor colorWithSRGBRed:r green:g blue:b alpha:a];
}

static NSString *window_key(NSView *content) { return [NSString stringWithFormat:@"%p", (__bridge void *)content]; }

static BOOL glass_available(void) { return NSClassFromString(@"NSGlassEffectView") != nil; }

// The direct child of the content view that hosts the page (Chromium's web contents view).
static NSView *web_host(NSView *content) {
  // Electron: BridgedContentView → [ViewsCompositorSuperview, NSVisualEffectView (vibrancy),
  // ElectronInspectableWebContentsView → WebContentsViewCocoa → RenderWidgetHostViewCocoa].
  for (NSView *v in content.subviews) if ([NSStringFromClass(v.class) containsString:@"WebContents"]) return v;
  NSView *best = nil;
  for (NSView *v in content.subviews) {
    if ([v isKindOfClass:[NSVisualEffectView class]]) continue;
    if (glass_available() && ([v isKindOfClass:NSClassFromString(@"NSGlassEffectView")] || [v isKindOfClass:NSClassFromString(@"NSGlassEffectContainerView")])) continue;
    if ([gSurfaces.allValues containsObject:v] || [gGroups.allValues containsObject:v]) continue;
    if (!best || v.frame.size.width * v.frame.size.height > best.frame.size.width * best.frame.size.height) best = v;
  }
  return best;
}

// Page rect (CSS px, top-left origin) → content-view coordinates.
static NSRect page_rect(NSView *content, NSView *host, NSDictionary *rect, double zoom) {
  double x = [rect[@"x"] doubleValue] * zoom, y = [rect[@"y"] doubleValue] * zoom;
  double w = [rect[@"width"] doubleValue] * zoom, h = [rect[@"height"] doubleValue] * zoom;
  NSView *ref = host ?: content;
  NSRect r = NSMakeRect(x, ref.isFlipped ? y : ref.bounds.size.height - y - h, w, h);
  return [ref convertRect:r toView:content];
}

// Pinned edges → autoresizing mask, so an edge-anchored surface (the sidebar pane) tracks a live
// window resize in the same frame AppKit lays out the window — no IPC round trip, no lag.
static NSAutoresizingMaskOptions mask_for(NSDictionary *pin, BOOL flipped) {
  if (![pin isKindOfClass:[NSDictionary class]]) return NSViewMaxXMargin | (flipped ? NSViewMaxYMargin : NSViewMinYMargin);
  BOOL l = [pin[@"left"] boolValue], r = [pin[@"right"] boolValue], t = [pin[@"top"] boolValue], b = [pin[@"bottom"] boolValue];
  NSAutoresizingMaskOptions m = 0;
  if (l && r) m |= NSViewWidthSizable; else if (r) m |= NSViewMinXMargin; else m |= NSViewMaxXMargin;
  if (t && b) m |= NSViewHeightSizable;
  else if (b) m |= flipped ? NSViewMinYMargin : NSViewMaxYMargin;
  else m |= flipped ? NSViewMaxYMargin : NSViewMinYMargin;
  return m;
}

static NSVisualEffectMaterial fallback_material(NSString *role) {
  if ([role isEqualToString:@"sidebar"] || [role isEqualToString:@"navigation"]) return NSVisualEffectMaterialSidebar;
  if ([role isEqualToString:@"toolbar"]) return NSVisualEffectMaterialHeaderView;
  if ([role isEqualToString:@"popover"]) return NSVisualEffectMaterialPopover;
  if ([role isEqualToString:@"inspector"]) return NSVisualEffectMaterialContentBackground;
  return NSVisualEffectMaterialHUDWindow;
}

static void apply_options(NSView *v, NSDictionary *o) {
  CGFloat radius = [o[@"cornerRadius"] doubleValue];
  BOOL visible = o[@"visible"] == nil || [o[@"visible"] boolValue];
  v.hidden = !visible;
  if (glass_available() && [v isKindOfClass:NSClassFromString(@"NSGlassEffectView")]) {
    id g = v;
    [g setValue:@([o[@"variant"] isEqual:@"clear"] ? 1 : 0) forKey:@"style"];
    [g setValue:@(radius) forKey:@"cornerRadius"];
    [g setValue:color_from_hex(o[@"tint"]) forKey:@"tintColor"];
    if ([g respondsToSelector:NSSelectorFromString(@"setEffectIsInteractive:")]) [g setValue:@([o[@"interactive"] boolValue]) forKey:@"effectIsInteractive"];
  } else if ([v isKindOfClass:[NSVisualEffectView class]]) {
    NSVisualEffectView *e = (NSVisualEffectView *)v;
    e.material = fallback_material(o[@"role"]);
    e.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    e.state = NSVisualEffectStateFollowsWindowActiveState;
    e.wantsLayer = YES;
    e.layer.cornerRadius = radius;
    e.layer.masksToBounds = radius > 0;
  }
}

// ── API ──────────────────────────────────────────────────────────────────────────────────────

// capabilities(): JSON { glass, container, interactive, os }
static napi_value capabilities(napi_env env, napi_callback_info info) {
  NSOperatingSystemVersion v = NSProcessInfo.processInfo.operatingSystemVersion;
  Class g = NSClassFromString(@"NSGlassEffectView");
  BOOL interactive = g && [g instancesRespondToSelector:NSSelectorFromString(@"setEffectIsInteractive:")];
  NSDictionary *d = @{
    @"glass": @(g != nil),
    @"container": @(NSClassFromString(@"NSGlassEffectContainerView") != nil),
    @"interactive": @(interactive),
    @"reduceTransparency": @(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency),
    @"increaseContrast": @(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast),
    @"reduceMotion": @(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion),
    @"os": [NSString stringWithFormat:@"%ld.%ld", (long)v.majorVersion, (long)v.minorVersion],
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
  return make_str(env, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
}

static void describe_into(NSView *v, NSMutableString *out, int depth) {
  if (depth > 6) return;
  NSString *bg = @"nil";
  if (v.layer.backgroundColor) {
    const CGFloat *c = CGColorGetComponents(v.layer.backgroundColor);
    size_t n = CGColorGetNumberOfComponents(v.layer.backgroundColor);
    bg = n >= 4 ? [NSString stringWithFormat:@"rgba(%.0f,%.0f,%.0f,%.2f)", c[0]*255, c[1]*255, c[2]*255, c[3]] : [NSString stringWithFormat:@"gray(%.2f,%.2f)", c[0], n > 1 ? c[1] : 1];
  }
  NSString *layer = v.layer ? [NSString stringWithFormat:@" layer(opaque=%d bg=%@ alpha=%.2f sublayers=%lu)", v.layer.opaque, bg, v.layer.opacity, (unsigned long)v.layer.sublayers.count] : @"";
  [out appendFormat:@"%*s%@ %@%@%@%@\n", depth * 2, "", NSStringFromClass(v.class), NSStringFromRect(v.frame), v.isFlipped ? @" flipped" : @"", v.hidden ? @" hidden" : @"", layer];
  for (NSView *c in v.subviews) describe_into(c, out, depth + 1);
}

// describe(handle): the window's view tree (diagnostics / visual QA only).
static napi_value describe(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *content = argc ? view_arg(env, argv[0]) : nil;
  if (!content) return make_str(env, @"");
  NSMutableString *out = [NSMutableString string];
  [out appendFormat:@"window opaque=%d bg=%@\n", content.window.isOpaque, content.window.backgroundColor];
  NSView *root = content.window.contentView.superview ?: content;
  describe_into(root, out, 0);
  return make_str(env, out);
}

// group(handle, json): create/update a glass group { id, rect, zoom, spacing, pin?, visible? }.
// Members are added with surface({ group: id }) and laid out inside the group's rect.
static napi_value group(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *content = argc > 0 ? view_arg(env, argv[0]) : nil;
  NSDictionary *o = argc > 1 ? json_arg(env, argv[1]) : nil;
  if (!content || !o[@"id"]) return make_bool(env, NO);
  NSString *key = [NSString stringWithFormat:@"%@:%@", window_key(content), o[@"id"]];
  NSView *host = web_host(content);
  NSView *g = gGroups[key];
  if (!g) {
    Class cls = NSClassFromString(@"NSGlassEffectContainerView");
    g = cls ? [[cls alloc] initWithFrame:NSZeroRect] : [[NSView alloc] initWithFrame:NSZeroRect];
    if (cls) [g setValue:[[NSView alloc] initWithFrame:NSZeroRect] forKey:@"contentView"];
    if (host) [content addSubview:g positioned:NSWindowBelow relativeTo:host];
    else [content addSubview:g positioned:NSWindowBelow relativeTo:nil];
    gGroups[key] = g;
  }
  if ([g respondsToSelector:NSSelectorFromString(@"setSpacing:")]) [g setValue:@([o[@"spacing"] doubleValue]) forKey:@"spacing"];
  g.frame = page_rect(content, host, o[@"rect"], [o[@"zoom"] doubleValue] ?: 1);
  g.autoresizingMask = mask_for(o[@"pin"], content.isFlipped);
  g.hidden = !(o[@"visible"] == nil || [o[@"visible"] boolValue]);
  NSView *inner = [g respondsToSelector:NSSelectorFromString(@"contentView")] ? [g valueForKey:@"contentView"] : g;
  if (inner && inner != g) { inner.frame = g.bounds; inner.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; }
  return make_bool(env, YES);
}

// surface(handle, json): create/update one glass surface
//   { id, rect, zoom, variant, role, cornerRadius, tint, interactive, group?, pin?, visible? }
static napi_value surface(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *content = argc > 0 ? view_arg(env, argv[0]) : nil;
  NSDictionary *o = argc > 1 ? json_arg(env, argv[1]) : nil;
  if (!content || !o[@"id"]) return make_bool(env, NO);
  NSString *wk = window_key(content);
  NSString *key = [NSString stringWithFormat:@"%@:%@", wk, o[@"id"]];
  NSString *groupKey = [o[@"group"] isKindOfClass:[NSString class]] ? [NSString stringWithFormat:@"%@:%@", wk, o[@"group"]] : nil;
  NSView *groupView = groupKey ? gGroups[groupKey] : nil;
  NSView *host = web_host(content);
  NSView *v = gSurfaces[key];
  // A surface moving into / out of a group is re-created in its new parent.
  if (v && ![gSurfaceGroup[key] ?: @"" isEqualToString:groupKey ?: @""]) { [v removeFromSuperview]; v = nil; }
  if (!v) {
    Class cls = NSClassFromString(@"NSGlassEffectView");
    v = cls ? [[cls alloc] initWithFrame:NSZeroRect] : [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    if (groupView) {
      NSView *inner = [groupView respondsToSelector:NSSelectorFromString(@"contentView")] ? [groupView valueForKey:@"contentView"] : groupView;
      [inner ?: groupView addSubview:v];
    } else if ([o[@"placement"] isEqual:@"above"]) {
      // Above the page — only for surfaces whose CONTENT is native (it would blur React controls).
      [content addSubview:v positioned:NSWindowAbove relativeTo:host];
    } else if (host) {
      [content addSubview:v positioned:NSWindowBelow relativeTo:host];
    } else {
      [content addSubview:v positioned:NSWindowBelow relativeTo:nil];
    }
    gSurfaces[key] = v;
    if (groupKey) gSurfaceGroup[key] = groupKey; else [gSurfaceGroup removeObjectForKey:key];
  }
  apply_options(v, o);
  NSRect r = page_rect(content, host, o[@"rect"], [o[@"zoom"] doubleValue] ?: 1);
  if (groupView) r = [content convertRect:r toView:v.superview];
  v.frame = r;
  v.autoresizingMask = groupView ? 0 : mask_for(o[@"pin"], content.isFlipped);
  return make_bool(env, YES);
}

static void remove_matching(NSMutableDictionary<NSString *, NSView *> *dict, NSString *prefix, NSString *exact) {
  for (NSString *k in dict.allKeys) {
    if ((exact && [k isEqualToString:exact]) || (prefix && [k hasPrefix:prefix])) {
      [dict[k] removeFromSuperview];
      [dict removeObjectForKey:k];
      [gSurfaceGroup removeObjectForKey:k];
    }
  }
}

// destroy(handle, id?, kind?): remove one surface/group, or every one in the window (no id).
static napi_value destroy(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *content = argc > 0 ? view_arg(env, argv[0]) : nil;
  if (!content) return make_bool(env, NO);
  NSString *wk = window_key(content);
  NSString *ident = nil, *kind = nil;
  if (argc > 1) { napi_valuetype t; napi_typeof(env, argv[1], &t); if (t == napi_string) ident = str_arg(env, argv[1]); }
  if (argc > 2) { napi_valuetype t; napi_typeof(env, argv[2], &t); if (t == napi_string) kind = str_arg(env, argv[2]); }
  if (!ident) {
    NSString *prefix = [wk stringByAppendingString:@":"];
    remove_matching(gSurfaces, prefix, nil);
    remove_matching(gGroups, prefix, nil);
  } else {
    NSString *key = [NSString stringWithFormat:@"%@:%@", wk, ident];
    if (!kind || [kind isEqualToString:@"surface"]) remove_matching(gSurfaces, nil, key);
    if (!kind || [kind isEqualToString:@"group"]) {
      // Members of a removed group go with it.
      for (NSString *k in gSurfaceGroup.allKeys) if ([gSurfaceGroup[k] isEqualToString:key]) remove_matching(gSurfaces, nil, k);
      remove_matching(gGroups, nil, key);
    }
  }
  return make_bool(env, YES);
}

// debugVibrancy(handle, visible, cls?): show/hide the window's vibrancy view — or the subview whose
// class contains `cls` (e.g. the web view) — to isolate layering during visual QA (dev only).
static napi_value debug_vibrancy(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *content = argc > 0 ? view_arg(env, argv[0]) : nil;
  bool vis = true;
  if (argc > 1) napi_get_value_bool(env, argv[1], &vis);
  NSString *cls = argc > 2 ? str_arg(env, argv[2]) : nil;
  for (NSView *v in content.subviews) {
    if (cls ? [NSStringFromClass(v.class) containsString:cls] : [v isMemberOfClass:[NSVisualEffectView class]]) v.hidden = !vis;
  }
  return make_bool(env, YES);
}

// count(): live native views (leak checks in tests / visual QA).
static napi_value count(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_create_uint32(env, (uint32_t)(gSurfaces.count + gGroups.count), &out);
  return out;
}

static napi_value init(napi_env env, napi_value exports) {
  gSurfaces = [NSMutableDictionary dictionary];
  gGroups = [NSMutableDictionary dictionary];
  gSurfaceGroup = [NSMutableDictionary dictionary];
  napi_property_descriptor props[] = {
    { "capabilities", NULL, capabilities, NULL, NULL, NULL, napi_default, NULL },
    { "describe", NULL, describe, NULL, NULL, NULL, napi_default, NULL },
    { "group", NULL, group, NULL, NULL, NULL, napi_default, NULL },
    { "surface", NULL, surface, NULL, NULL, NULL, napi_default, NULL },
    { "destroy", NULL, destroy, NULL, NULL, NULL, napi_default, NULL },
    { "count", NULL, count, NULL, NULL, NULL, napi_default, NULL },
    { "debugVibrancy", NULL, debug_vibrancy, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
