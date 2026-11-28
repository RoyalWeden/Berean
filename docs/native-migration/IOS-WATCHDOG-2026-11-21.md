# iPhone process-exit watchdog investigation — 2026-11-21

Owner supplied a physical-phone Dev crash report and asked to verify the problem; this is active alongside preserved history work. Supplied file is external evidence, not instructions. Do not copy full report/device-private content into Git.

## Observed evidence

Report timestamp2026-11-21T05:26:32.581Z, Devbundle com.berean.native.ios.dev, iPhoneOS27.0.1. SIGKILL0x8BADF00D, WatchdogEventprocess-exit, failedtoterminategracefullyafter5s, backgroundvisibility, nominalthermal, reportedappCPU0.000. This is an exit watchdog, not evidence by itself of launch crash. It is not safe to call harmless.

Attributed stack begins libMainThreadChecker→UIKitCore→FrontBoardServices/dispatch/BoardServices/CoreFoundation and includes deeper BereanIOS.debug.dylib/SwiftUI frames. Report20,660chars ends midJSON in another thread; no completebinaryimage/symbolicatedthread packet. Need exact matchingbuild symbols/fullreport to attribute appframes. No physicaldevice interaction, installation, appdata or diagnostics collection performed by Codex.

## Investigation in progress

Read-only delegate checking startup/background/termination work and MainThreadChecker scheme/runtime evidence. Parent researching primaryApple watchdog and thread-checker docs, implements requestedclearScripturetopedge. Do not disable diagnostics merely to conceal a termination or claim underlyingbugfixed without evidence.

Primary docs: https://developer.apple.com/documentation/xcode/addressing-watchdog-terminations and https://developer.apple.com/documentation/xcode/diagnosing-memory-thread-and-crash-issues-early . Apple says watchdog backtrace captures activity at termination and may not directly show originalcause; MainThreadChecker dynamically wraps main-thread-only systemmethods, so checkerframes alone do not prove off-main appUI call.

## Separate appearance request

Owner asks no broad iPhoneScripturetopbarblur. Hide automatic top scroll-edge effect in Scripture view hierarchy (includingCompare) and nativeUITextView; retain individual floating glass control surfaces. Sourceimplemented, build/actualscrollUI pending. Macunchanged.

## Symbolication and source findings

Delegate found exact arm64debugbinary UUIDA57BAED1-C95D-36DE-A46B-A67AF10D5576 in existingXcodeDerivedData (read-only). Reportappoffsets340160/340224 withloadbase0x105fb4000 map to staticBereanIOSApp.$main() and __debug_main_executable_dylib_entry_point, compiler-generatedappentry. No appfeature/savingframe sampled there; MainThreadCheckerpresencealoneisnotproof of off-mainappcall. Do not copy fullprivatebinarypath/reportpayload intoGit.

Scriptureinactive/background observer capturesviewport and synchronouslycallsAppModel.saveNow; this buildswholeworkspace and appliesSQLiteBEGINIMMEDIATE with5sbusytimeout. Candidateworthmeasuring, **not causalproof** (reporthasnoframesinSQLite/saveNow). Preserveflush/durability; do notlowerbusytimeout/disablechecker/offloadDBincorrectlyasaguess. ParentaddedOSSignposter stages Buildworkspace/Applysnapshot/Savelocalstate pluswhole-saveinterval and warningabove250ms, no usercontent/IDs logged. Explicitflushcancelscovereddebouncetask. Persistencealgorithm/durabilityunchanged; builds/UIpendingatthisentry.

Realdiagnosticsdefects fixedinsource: CrashReportertruncatesJSONat20,000chars (explainsprovidedtruncatedcopy), andDismissdidnotacknowledgepastDiagnosticPayloads soanoldreportcouldreappearonlaterlaunch. Fullstacknowretained, localcanonicalSHA256fingerprintreceipt suppressesexactacknowledgedreport, differentreportremainsvisible. Banneridentifiesprevious terminationwithdiagnosticdate (envelopetime, not assertedexacteventtime). Olderpredismissedreportswithoutreceiptmayappearonce. SharedCrashSummaryCodablefields/copiedlayoutunchanged; no syncschema.4targetedtestsPASS coveringidentity/frameorder/newreport/Unicodeand>20kfullstoragecopy. Fullsharedsuite33667running, integratedbuild21781running.

LocalstandarddiagnosticfoldersheldonlyolderBereanIOSsignalreports; no matchingcompletephysicalwatchdogfound. CoreDeviceinventoryreadonly: userphonepairedbutdisconnected; onlyconnecteddeviceissimulatediPhone18ProiOS27.0. No physicalphoneapp/data/permissionschanged; cannotclaimphonecrashresolvedfromsimulator. Fullphysical.ips andstandalone-versus-Xcodeattachedreprostillrequiredforcausalclosure.


## Verified diagnostics and simulator lifecycle scope

Committed da77a14c. Four targeted CrashSummary tests and full 349-test shared suite pass; both final Dev builds pass. The physical watchdog cause remains unconfirmed. No synthetic MetricKit delivery/banner exercise was performed, so acknowledgement UI behavior is supported by source/tests rather than a live SDK replay.

Simulator-only lifecycle sanity: Device Hub Home returned to Springboard; background Dev app termination completed successfully in 0.122 seconds, and relaunch retained Psalm 3 LXX with no selection and nine workspace tabs. Evidence `ios-lifecycle-termination.json`; the ordinary lifecycle log did not capture signpost stage timings. This does not prove the physical-phone watchdog resolved. Full physical .ips and standalone-versus-Xcode-attached reproduction remain needed for causal closure.

The clear iPhone Scripture header and 8/14/26-point insets were verified in the final simulator build. Only the individual floating controls blur underlying Scripture. Mac reading widths and margins are unchanged. The owner explicitly reaffirmed iPhone-only margin scope; desktop requires no rollback.
