# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.3.2](https://github.com/bbidwell85/totality/compare/v0.3.1...v0.3.2) (2026-04-07)


### Features

* add 75% opacity and backdrop blur to Tag Sync panel ([fc2cb93](https://github.com/bbidwell85/totality/commit/fc2cb938d83c68043e1c0eda0168736e5eb82cc1))
* add genre extraction from Plex and Kodi, generalize tag sync ([0061527](https://github.com/bbidwell85/totality/commit/00615274044c086ac4ca6dbbbf572d1353f8b7d8))
* add genre write support for MediaMonkey and Kodi ([7499f56](https://github.com/bbidwell85/totality/commit/7499f56fed81f886971886452b4202fd02ffb5c8))
* add Kodi mood write with safety guards ([ebce11a](https://github.com/bbidwell85/totality/commit/ebce11a26c98fdf36d94277250f927b6523e1d7d))
* add MediaMonkey provider with mood extraction and FFmpeg co-install ([fc66e2b](https://github.com/bbidwell85/totality/commit/fc66e2b2b81a25589cca01328bd1d2278ab51221))
* add mood sync comparison UI and Plex mood write ([f807447](https://github.com/bbidwell85/totality/commit/f807447009117256fa39f24494e72b7fa3e37808))
* add Overwrite/Append mode toggle for mood sync ([95eebb6](https://github.com/bbidwell85/totality/commit/95eebb66e33446e3a69cac95e8362e085ec49f90))
* add per-track sync animation and failure indicators ([57a0677](https://github.com/bbidwell85/totality/commit/57a0677e506575b8266c1e921cc701f2babc2cd3))
* add search, selective sync, and source comparison to Mood Sync panel ([7684667](https://github.com/bbidwell85/totality/commit/7684667e749eb322b85e1ff46f017b97be21cb28))
* auto-completeness after scans, live refresh, UI polish ([bcbb3ea](https://github.com/bbidwell85/totality/commit/bcbb3eaf4d72ea2a30bccde9fc8112cf773ed108))
* dual-field comparison view with difference highlighting ([b108cad](https://github.com/bbidwell85/totality/commit/b108caddffe400b4a131522e93fee641f46c34de))
* fetch Plex mood tags during music scan ([1bd10aa](https://github.com/bbidwell85/totality/commit/1bd10aa59e68a9d6772f38bce4a25258f2d30664))
* generalize sync to support mood and genre fields ([d719d41](https://github.com/bbidwell85/totality/commit/d719d4177f29c33bd83026d8b2ff7e67133ea0fc))
* move Mood Sync to dedicated panel with TopBar button ([d081681](https://github.com/bbidwell85/totality/commit/d0816817a79dcd9b316423a090c14a306aafe02c))
* restructure Tag Sync panel into logical steps ([60bd9b4](https://github.com/bbidwell85/totality/commit/60bd9b401540f281e83991296db0dd2a50ae1517))
* show genre and mood in music track details modal header ([b325ac5](https://github.com/bbidwell85/totality/commit/b325ac59694819bea785af0b8ace1e80584d5db5))
* support mood sync to read-only targets (MediaMonkey, Kodi Local) ([b00966b](https://github.com/bbidwell85/totality/commit/b00966bcf0f75f503d8914a176375ccea6c3521f))
* write mood tags to MediaMonkey database with safety guards ([637e3ab](https://github.com/bbidwell85/totality/commit/637e3ab7b8dc514dcf419beec9ee19135a1572d2))


### Bug Fixes

* 5 high-priority issues from pre-release audit ([828c9d6](https://github.com/bbidwell85/totality/commit/828c9d6fdde4cf0ed5555a5d2da3ebc7f9e72c68))
* align MoodSyncPanel with settings tab design patterns ([f363dbc](https://github.com/bbidwell85/totality/commit/f363dbcadf582c4a261c1862208f07fa2ca7384e))
* ambiguous source_id column in getIncompleteSeries query ([d1163ec](https://github.com/bbidwell85/totality/commit/d1163ec47b6efb39afb38b10d0ff2ec1b51a0e57))
* audit cleanup — lint warnings, ProviderType parity, queue guard, tag sync fixes ([71a7dbc](https://github.com/bbidwell85/totality/commit/71a7dbc73edc9069e1c93e94d594706e0b9e989c))
* centralize all deletion cleanup in database methods ([51573fc](https://github.com/bbidwell85/totality/commit/51573fc7b67d220c53751cdfe4e7126a3c698941))
* change mood sync logging from warn to log level ([4432ec1](https://github.com/bbidwell85/totality/commit/4432ec1449d751c06367ace3121342fbd3e5cf1e))
* code review cleanup — security, performance, accessibility ([e0c00b4](https://github.com/bbidwell85/totality/commit/e0c00b475c1b4203f7a8ed06422a78304e58aee1))
* comprehensive data layer audit — 42 findings across 9 categories ([809f53d](https://github.com/bbidwell85/totality/commit/809f53d8208ca0b66cf76e7e292378bc60df0345))
* comprehensive stale data cleanup after Plex deletions ([a20a246](https://github.com/bbidwell85/totality/commit/a20a2460059cd9ecb729a0c7641392f0932dfed2))
* dashboard data accuracy — 5 issues from comprehensive audit ([6e31df6](https://github.com/bbidwell85/totality/commit/6e31df672657133eaf2bb58cede4c3099c3763d7))
* deleted Plex items persisting on dashboard after rescan ([8c95587](https://github.com/bbidwell85/totality/commit/8c95587e32f5e8e8f7c8b30dd8050f37e247e49f))
* don't recalculate collections from empty join table, refresh dashboard on analysis complete ([18d2733](https://github.com/bbidwell85/totality/commit/18d27332b0fd4a6fc9cf9cf579a66c162798c946))
* fetch Plex mood tags via per-mood-tag endpoint ([17ea67b](https://github.com/bbidwell85/totality/commit/17ea67b6cb9334242371ecd76bd318c04ae7fa76))
* filter tag sync panel to only show supported providers ([06bab74](https://github.com/bbidwell85/totality/commit/06bab74bab3d0e5ded89729d3c66d7139ed11e53))
* increase Tag Sync panel opacity from 75% to 90% ([1bc480f](https://github.com/bbidwell85/totality/commit/1bc480f4a3c5bc221c7fda8cab06ff363688696e))
* move MoodSyncPanel outside dashboard-only block ([1d03b67](https://github.com/bbidwell85/totality/commit/1d03b672503490c9b7208c3860c80af1df56deab))
* optimize mood sync — count queries, shared utils, reduced memory ([3f43fb7](https://github.com/bbidwell85/totality/commit/3f43fb7e446d2c27245396a6a24b19cf0118de55))
* preserve mood data during rescans with COALESCE ([351289d](https://github.com/bbidwell85/totality/commit/351289d5a8638698951b639fd50e570385d54e14))
* QA architecture — transactions, debounce, safety guards ([e38d6a8](https://github.com/bbidwell85/totality/commit/e38d6a80519fc9b27311d53b203b35e454f8525e))
* redesign MoodSyncPanel to match WishlistPanel patterns ([3ba3c4d](https://github.com/bbidwell85/totality/commit/3ba3c4dc2d023bc4793e4c967d58d4a501fcb80f))
* remove broken recalculateCollectionStats, add library:updated listener ([8814974](https://github.com/bbidwell85/totality/commit/8814974c6d8b0760d73ba381b0aa2ca53025c149))
* replace field tabs with radio buttons, fix genre label text ([d001d61](https://github.com/bbidwell85/totality/commit/d001d619c8c1c4e883020c375bb7960afd41e55c))
* replace Music icon with Tags icon for Tag Sync panel ([42d4562](https://github.com/bbidwell85/totality/commit/42d45622149a889e3d700951c5fce3399309f39b))
* resolve FTS tokenizer and orphan index errors in MM5 write ([42ab98e](https://github.com/bbidwell85/totality/commit/42ab98e00e2945be82bf4b823d08cd3db842173e))
* revert COALESCE on mood upsert — rescans must reflect actual data ([66ee06c](https://github.com/bbidwell85/totality/commit/66ee06cff57a44cc0bd0f6a0790c411a63143c7a))
* set Tag Sync panel opacity to 90% ([8539973](https://github.com/bbidwell85/totality/commit/8539973e92761600e9e1855fc819400e251c412f))
* show sync success in panel after Kodi/MediaMonkey writes ([c5b19ab](https://github.com/bbidwell85/totality/commit/c5b19ab9b1ee1785e71d39fe5cbc7cec7a85a6be))
* split comma-separated moods from MediaMonkey into individual tags ([a9736a1](https://github.com/bbidwell85/totality/commit/a9736a1f08cc30d33e60af55a84a2cec810fbaf1))
* update album track_count and artist counts on track deletion ([9f80c50](https://github.com/bbidwell85/totality/commit/9f80c5055480cde49d05b717e4ff8f03c25f3258))
* update collections inline after movie deletion (no TMDB API calls) ([254fa9c](https://github.com/bbidwell85/totality/commit/254fa9c1155ae11a27158eceda5ed5b465450e37))
* update collections inside deleteMediaItem, not in caller ([7d9618b](https://github.com/bbidwell85/totality/commit/7d9618b12bec70eea726e972bf58be27448e969f))
* update local DB after mood sync to reflect changes in comparison ([432949d](https://github.com/bbidwell85/totality/commit/432949d59465b07b4caae5266cc6ef28da9bdaa6))
* update series completeness inline instead of deleting it ([90da795](https://github.com/bbidwell85/totality/commit/90da795898e826d17f629f014fb8be9cdecbc59e))
* update write log messages from "mood updates" to "tag updates" ([a41cba4](https://github.com/bbidwell85/totality/commit/a41cba42886334da7f8c32265dac3533afdd8583))
* use bg-card/95 for Tag Sync panel background tint ([8827c9f](https://github.com/bbidwell85/totality/commit/8827c9fb3e3dd6de18c43baddc5f93e650b29af8))
* use theme card color at 90% opacity for Tag Sync panel ([3a3dc1a](https://github.com/bbidwell85/totality/commit/3a3dc1a1f828d6f5009c932182851c29cd036cc1))
* validate collection ownership during orphan cleanup ([bea616b](https://github.com/bbidwell85/totality/commit/bea616b0eff5b41df657609357834f61bad65bde))

### [0.3.1](https://github.com/bbidwell85/totality/compare/v0.3.0...v0.3.1) (2026-03-26)


### Features

* notifications system, TopBar modernization, and UI refinements ([3b0509c](https://github.com/bbidwell85/totality/commit/3b0509cfee15160aabad3dfe53fb3a09ca3e5f07))


### Bug Fixes

* multiple library view and dashboard bug fixes ([7244f5d](https://github.com/bbidwell85/totality/commit/7244f5d11f6f9d247c950745a511ad9be9525cb9))
* switch coverage provider from v8 to istanbul ([d567bae](https://github.com/bbidwell85/totality/commit/d567bae70e7631f5cc90ff34992b772548425ce5))

## [0.3.0](https://github.com/bbidwell85/totality/compare/v0.2.3...v0.3.0) (2026-03-22)


### Features

* major dependency upgrades — Electron 41, Vite 6, ESLint 9 ([22f4eda](https://github.com/bbidwell85/totality/commit/22f4edaf8e0ece79856126bd4a265817c184547d))
* migrate to Tailwind CSS 4 and fix library scrollbar styling ([b757501](https://github.com/bbidwell85/totality/commit/b7575017c8e1d8b7380a842ba800618aaf14e916))
* quality scoring overhaul, preference persistence, and UI improvements ([56a3343](https://github.com/bbidwell85/totality/commit/56a3343b31fe87754b09122366ca887be6363edb))

### [0.2.3](https://github.com/bbidwell85/totality/compare/v0.2.2...v0.2.3) (2026-03-21)


### Bug Fixes

* resolve TypeScript build errors across all platforms ([85aa558](https://github.com/bbidwell85/totality/commit/85aa5582e3f222eceb6123f59a32c8fa9a3878df))

### [0.2.2](https://github.com/bbidwell85/totality/compare/v0.2.1...v0.2.2) (2026-03-21)


### Features

* major UI consistency overhaul, search navigation, and UX improvements ([a44b04c](https://github.com/bbidwell85/totality/commit/a44b04ce9ad3092f32d14529b28ffea5184d71cd))
* major UI polish, bug fixes, security audit fixes, and memory optimization ([ce7f1d5](https://github.com/bbidwell85/totality/commit/ce7f1d5cc748181d184aae21a31e2e944da333d3))

### [0.2.1](https://github.com/bbidwell85/totality/compare/v0.2.0...v0.2.1) (2026-03-18)


### Bug Fixes

* resolve NOT NULL constraint failures in collection/series analysis and AI panel reactivity ([122683c](https://github.com/bbidwell85/totality/commit/122683cca1e0e521d1e99fb22512099301ec973b))

## [0.2.0](https://github.com/bbidwell85/totality/compare/v0.1.19...v0.2.0) (2026-03-17)


### Features

* add AI music tools, security audit fixes, faster startup, and UI improvements ([d498c6d](https://github.com/bbidwell85/totality/commit/d498c6d32c4c5c29c3655e488416b87e5928fe99))
* enhance AI chat, add verbose logging, and expose file logging settings ([6380def](https://github.com/bbidwell85/totality/commit/6380def3b190eb238f2682c4d82e6527b31c7f85))
* improve AI assistant, fix quality scoring, and clean up stale Plex items ([f9ac451](https://github.com/bbidwell85/totality/commit/f9ac4515ce45ff652f1d04714c47c63de7532260))
* replace Claude AI with Gemini, add TMDB search tool, and optimize token usage ([af6628a](https://github.com/bbidwell85/totality/commit/af6628aa77e2f2f2717f1b44920f1e12ea3089ea))

### [0.1.19](https://github.com/bbidwell85/totality/compare/v0.1.18...v0.1.19) (2026-02-20)


### Features

* add codec efficiency UI and correct AV1 default to 2.5x ([688e51f](https://github.com/bbidwell85/totality/commit/688e51f714f87ece7f6657ec8559b2f8b25d9faf))
* add copy-to-clipboard button for Handbrake extra options ([1ce98f7](https://github.com/bbidwell85/totality/commit/1ce98f74c2fc8363e8a9cb741be8ac9287d5e785))
* add item count stats bars to Movies and TV Shows views ([451d678](https://github.com/bbidwell85/totality/commit/451d6785aed5ce9550c736a656857c710e7f217d))
* add sort title support, fix Emby collections, and scope completeness by source ([fbf1c9c](https://github.com/bbidwell85/totality/commit/fbf1c9c2bafde18cf51426ed241a6ac051106a63))
* add task queue persistence (H3) and file-based logging (M5) ([d32db18](https://github.com/bbidwell85/totality/commit/d32db180aa2ac5c2036fc8b717fc2659eec1ce42))
* auto-complete wishlist items when library content is added or upgraded ([70aa951](https://github.com/bbidwell85/totality/commit/70aa9515ea9d905a3c8fc15440e713427d1c2f3d))


### Bug Fixes

* add Zod validation to all unvalidated IPC handlers ([4071c8c](https://github.com/bbidwell85/totality/commit/4071c8c5ef9d4ba20396c8dba4c42644899aae29))
* address remaining medium-priority production findings ([b8580c0](https://github.com/bbidwell85/totality/commit/b8580c0f647cec2fe04916cc60f4cd47e8118675))
* bugs, security, performance, and infrastructure fixes from full audit ([00d0aab](https://github.com/bbidwell85/totality/commit/00d0aabe36b2a5b39637de52ea09ede5d6a32a0f))
* completeness panel stats now account for dismissed items and EP/Singles toggle ([34200a9](https://github.com/bbidwell85/totality/commit/34200a97197ccf70d70088467c5b9ceabe563288))
* consolidate Quality settings tab — move codec efficiency into Video Quality card, slim threshold bars ([7c163f7](https://github.com/bbidwell85/totality/commit/7c163f7b8cfbbf6dad60ed0ff4bad31bdc59398d))
* correct Emby/Jellyfin video bitrate to exclude audio from container bitrate ([079df25](https://github.com/bbidwell85/totality/commit/079df2583ce6d52f6d31c53bca1ccda08cf87c1a))
* harden security, performance, and reliability ([6565ae4](https://github.com/bbidwell85/totality/commit/6565ae4a39468e283974510c4633db99151cd295))
* live-update dashboard and completeness panel when EP/Singles settings change ([0e91a26](https://github.com/bbidwell85/totality/commit/0e91a26595780534d3b54b8ddec75268c1f5fddd))
* low-priority hardening (symlink check, query limit) ([3812979](https://github.com/bbidwell85/totality/commit/38129794e4a225102ad35d26cce5cd9ccc7478c2))
* move EP/Singles filtering server-side and add live settings refresh ([b863056](https://github.com/bbidwell85/totality/commit/b8630567a8a73a6f6c9de85cbdacf7e858477782))
* split MediaBrowser into view components, improve network detection, remove dead code ([baceca5](https://github.com/bbidwell85/totality/commit/baceca55c41486d968885ae8cfeac0814e30ee20))

### [0.1.18](https://github.com/bbidwell85/totality/compare/v0.1.17...v0.1.18) (2026-02-16)


### Features

* add source type and codec dedup to version labels, per-source scan button, and video bitrate display ([bc667e8](https://github.com/bbidwell85/totality/commit/bc667e8c2d14637f03eb32c678f89701e2d034f5))
* log multi-select with copy, consistent icons, and external link handling ([897c33a](https://github.com/bbidwell85/totality/commit/897c33ada6e37c13ab55e580fd70bf945e56b460))
* multi-version grouping for Kodi/local providers, minimize to tray, and quality fixes ([ba4edf3](https://github.com/bbidwell85/totality/commit/ba4edf312d14189a9df72cd8fcc4216e83528be3))
* multi-version tracking with smart edition naming and Linux sandbox fix ([b35108c](https://github.com/bbidwell85/totality/commit/b35108cf9bdf9c096f8d36af50d56042905e01a0))
* open Plex login and TMDB link in default browser ([e860b82](https://github.com/bbidwell85/totality/commit/e860b827c2e7cf6432f34a4a3edf154a57614e8f))
* per-version split scores, deduplicate MediaDetails modal, and UI polish ([cd608d7](https://github.com/bbidwell85/totality/commit/cd608d7e1935478b6778bc84fdf299c65112c83f))


### Bug Fixes

* match completeness panel dropdowns to app-wide select styling ([ece74fa](https://github.com/bbidwell85/totality/commit/ece74faceac79892b3b82422f5c200d4aa845b2d))
* resolve TypeScript error in LocalFolderProvider source type check ([8aa600a](https://github.com/bbidwell85/totality/commit/8aa600a6a7eda8c5af8636b814e4b63b684ee6c3))
* static axios imports and dashboard collections threshold ([4c3402e](https://github.com/bbidwell85/totality/commit/4c3402e603844808692a9af1392cb034420d035d))
* use video-only bitrate instead of container bitrate and add General settings tab ([5113b4a](https://github.com/bbidwell85/totality/commit/5113b4ae1256aac9c4b095aca44d18b0a3b9f1c1))

### [0.1.17](https://github.com/bbidwell85/totality/compare/v0.1.16...v0.1.17) (2026-02-13)


### Bug Fixes

* use explicit NSIS artifact name to prevent auto-update 404 ([e211634](https://github.com/bbidwell85/totality/commit/e211634272e55daf73a816e41a3a035826d121f3))

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
