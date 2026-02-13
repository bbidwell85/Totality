# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.16](https://github.com/bbidwell85/totality/compare/v0.1.15...v0.1.16) (2026-02-13)


### Features

* add server-side pagination for movies/albums, dashboard improvements, and library enhancements ([3017f28](https://github.com/bbidwell85/totality/commit/3017f28d166de967b4662d18f0a1cdbeade3e20f))


### Bug Fixes

* add missing pagination filters and server-side artist pagination ([7a002d3](https://github.com/bbidwell85/totality/commit/7a002d3b38fb2fadd5e620f333533b7e37b2fe94))
* allow auto-update checks in dev mode for testing ([f5f6389](https://github.com/bbidwell85/totality/commit/f5f6389a277a39f2423e8b665d87de3b468077c9))
* handle hyphenated AC-3 codec in audio quality scoring ([61410eb](https://github.com/bbidwell85/totality/commit/61410ebc6acbaf066cc565ff548ae0999c9857f8))
* modal overlay z-index, missing filter validation, collections filter, and cleanup ([40f38aa](https://github.com/bbidwell85/totality/commit/40f38aa44ded5d64a0607a24d781b42264dfc16d))

### [0.1.15](https://github.com/bbidwell85/totality/compare/v0.1.14...v0.1.15) (2026-02-11)


### Features

* add auto-update with electron-updater and GitHub Releases ([3f0a6ab](https://github.com/bbidwell85/totality/commit/3f0a6ab7c4525e5cab14efa33a5db6dd480f9444))


### Bug Fixes

* deduplicate concurrent getLibraries calls, return empty on timeout ([7eb201d](https://github.com/bbidwell85/totality/commit/7eb201d53d9d4fcb4f89f472b960ffdaa43c7cab))
* deduplicate Plex error logging, redact IPs, fix triple FFprobe log ([ad6a07e](https://github.com/bbidwell85/totality/commit/ad6a07e4ed0d2931464ce5379ceb759eca6d09e2))
* try all Plex connections before failing, show friendly error message ([8fe0bf5](https://github.com/bbidwell85/totality/commit/8fe0bf5e156621db0fb3aa91f22053af254caa69))

### [0.1.14](https://github.com/bbidwell85/totality/compare/v0.1.13...v0.1.14) (2026-02-11)


### Features

* enrich log exports with diagnostics, silent failure warnings, and scan summaries ([fa9d47d](https://github.com/bbidwell85/totality/commit/fa9d47dbab4b2b64797fb3acef8685fa2c3a5098))
* include connected sources and server versions in log exports ([ce69c46](https://github.com/bbidwell85/totality/commit/ce69c464ddcb85b26068303f925b31c1a0fb82c0))


### Bug Fixes

* handle HTTP 303/308 redirects in FFprobe download ([89e8aab](https://github.com/bbidwell85/totality/commit/89e8aabc5a6234439fd6b0d413e7910f417fcfb3))
* hide FFprobe uninstall button for system-installed FFprobe ([cdedb05](https://github.com/bbidwell85/totality/commit/cdedb05e721c56e673e82694c37f839b463a53ec))
* Kodi music scan now responds to cancellation from activity monitor ([6d55522](https://github.com/bbidwell85/totality/commit/6d555220c7a9540ad26e59f2b519fc19562b095e))
* Kodi scan now responds to cancellation from activity monitor ([c44f350](https://github.com/bbidwell85/totality/commit/c44f3503dc5ba142ec632e60a30315248bfe4f46))
* paginate Plex API calls to avoid locking PMS database ([98e4d28](https://github.com/bbidwell85/totality/commit/98e4d289697637e2bf1dcc805e749f861adfa491))
* redact personal information from logs and exports ([d0d3cab](https://github.com/bbidwell85/totality/commit/d0d3cab175bbcb2c2663c2fb0c89507c4d8cb957))
* redact remaining file paths, URLs, and credentials from all log statements ([97b7997](https://github.com/bbidwell85/totality/commit/97b79972f674e686592448fa1600e1364a62f425))
* sanitize home directory from log entries to prevent username leaks ([ed17ace](https://github.com/bbidwell85/totality/commit/ed17ace531a32a5ad1b2c1b61e975d80d52ec607))
* serialize concurrent getLibraries calls in KodiLocalProvider ([4662fa1](https://github.com/bbidwell85/totality/commit/4662fa1242d10f38d9d25e0c97dd7e3a72bb5beb))
* treat task cancellations as cancelled not failed, handle Kodi DB not ready ([dd68c4e](https://github.com/bbidwell85/totality/commit/dd68c4e64bad2316d882bc72763d2eae35196b08))

### [0.1.10](https://github.com/bbidwell85/totality/compare/v0.1.9...v0.1.10) (2026-02-08)


### Bug Fixes

* dashboard columns now fill full height, add screenshots to README ([77ef429](https://github.com/bbidwell85/totality/commit/77ef4292363a7f988cce2abb1b6bea2212ad224b))

### [0.1.9-beta.0](https://github.com/bbidwell85/totality/compare/v0.1.8...v0.1.9-beta.0) (2026-02-07)


### Bug Fixes

* use full Developer ID Application identity for macOS signing ([5958a20](https://github.com/bbidwell85/totality/commit/5958a20d0f94fc4609eb7d7158c7c5ae3e03adbb))

### [0.1.8](https://github.com/bbidwell85/totality/compare/v0.1.7...v0.1.8) (2026-02-07)


### Features

* filter Dashboard content by selected source ([5627f0a](https://github.com/bbidwell85/totality/commit/5627f0abda6eaa407ba6cb3216ee435cc4f3c9f0))


### Bug Fixes

* join quality_scores table in getMediaItems for upgrade icons ([c101396](https://github.com/bbidwell85/totality/commit/c10139656a179bdff79b4c4d5c8ed1fbc7edcf53))

### [0.1.7](https://github.com/bbidwell85/totality/compare/v0.1.6...v0.1.7) (2026-02-06)


### Features

* add Zod validation to critical IPC handlers ([5552d58](https://github.com/bbidwell85/totality/commit/5552d586d6156dfc499c714b67d94ac33acf9d15))
* implement strategic performance improvements ([a8be43d](https://github.com/bbidwell85/totality/commit/a8be43db25d4b8e364f87c032bd6e19dc7a3b198))


### Bug Fixes

* add request timeouts to TMDB and Plex API calls ([3ea9231](https://github.com/bbidwell85/totality/commit/3ea923137876f5261069056bfabd6980af9c9007))
* replace error: any with error: unknown across codebase ([9f84c0c](https://github.com/bbidwell85/totality/commit/9f84c0cbb2f5795419c51e0bcd3e381fb455e437))
* resolve all ESLint warnings with proper TypeScript types ([4c7af4b](https://github.com/bbidwell85/totality/commit/4c7af4b798efb73226e4fc6188b64e06d76473e9))
* resolve database service compatibility issues ([613902b](https://github.com/bbidwell85/totality/commit/613902b414576cb9222ad6265e92bc57e00f3bc9))
* resolve memory leaks in LiveMonitoringService ([99a69e3](https://github.com/bbidwell85/totality/commit/99a69e336ca1c2d82eb61efbd0664c20dc992e20))
* **security:** prevent path traversal and restrict shell.openExternal URLs ([51f63c1](https://github.com/bbidwell85/totality/commit/51f63c11fd459940149178fdb5c99561dba00cfe))

### [0.1.6](https://github.com/bbidwell85/totality/compare/v0.1.5...v0.1.6) (2026-02-06)


### Features

* UI improvements for theming, dashboard, and search ([c69cb87](https://github.com/bbidwell85/totality/commit/c69cb87cfe1805e09cda1d6640c4303d464cb2a5))

### [0.1.5](https://github.com/bbidwell85/totality/compare/v0.1.5...v0.1.5) (2026-02-03)


### Bug Fixes

* externalize chokidar and fsevents for macOS CI builds ([1c7188e](https://github.com/bbidwell85/totality/commit/1c7188ecf6937e45a457539788cf0547d56b7c16))
* resolve TypeScript strict mode errors for CI builds ([dceb7b4](https://github.com/bbidwell85/totality/commit/dceb7b4f143a9fd1c62734b5d2768bd22d2d13dd))

### [0.1.4](https://github.com/bbidwell85/totality/compare/v0.1.5...v0.1.4) (2026-02-03)


### Bug Fixes

* resolve TypeScript strict mode errors for CI builds ([dceb7b4](https://github.com/bbidwell85/totality/commit/dceb7b4f143a9fd1c62734b5d2768bd22d2d13dd))

### [0.1.3](https://github.com/bbidwell85/totality/compare/v0.1.5...v0.1.3) (2026-02-03)

### [0.1.2](https://github.com/bbidwell85/totality/compare/v0.1.5...v0.1.2) (2026-02-03)

### 0.1.1 (2026-02-03)


### Features

* add keyboard navigation infrastructure (disabled by default) ([7e63f2b](https://github.com/bbidwell85/totality/commit/7e63f2b846040ee9f30318894435dbdc79b8be32))
* redesign settings tabs and add smooth queue drag-and-drop ([5a7154e](https://github.com/bbidwell85/totality/commit/5a7154e38bfaa5674e6b17f173169de6b0619852))
