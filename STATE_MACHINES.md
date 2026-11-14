# State-machine audit

Audit date: 2026-11-14. Scope: application-owned control state in `src/`, including gameplay, resource ownership, UI, persistence, asynchronous work, and retry paths. Third-party renderer, Rapier, WebRTC, and browser internals are outside this inventory. Continuous quantities (position, animation weight, volume, clock time) are recorded where they constrain a machine; they are not expanded into infinite states.

This is the single issue register and transition reference for this change. Issue IDs below are local audit issues, not externally filed tickets. “Fixed” means implemented with executable regression coverage; it does not imply real-device or live-peer verification. Transitions described below reflect the fixed implementation. Evidence sections preserve the pre-fix failure paths.

## Confirmed issues, ordered by impact

| Issue | Priority | Related fixes | Reachable pre-fix failure and evidence | Status / regression coverage |
|---|---|---|---|---|
| ISSUE-01 — Validate and isolate restored island progress | P1 | `IslandStates.load`, `PaddyField.setState` | `load({1:{trees:[],paddy:{s:[0]}}})` passed the old shape check. `PaddyField.setState` then called `Float32Array.set(undefined)` for the absent timer/height arrays, throwing during `Save.restore → enterIsland` and failing boot. Separately, switching quality changes crop instance count; a saved count mismatch caused `setState` to return without resetting the reused island-kind object, retaining the previous island's crops. | Fixed: validate all arrays/values before accepting an island record, copy accepted data, and use fresh crops when saved density is incompatible. Tests: corrupt island progress; incompatible crop density. |
| ISSUE-02 — Keep collection transitions alive when storage fails | P1 | Fishpedia and Inventory persistence; save reset | Catch ran `pedia.record → save → inventory.add → beginReel`. Both `save` methods called `localStorage.setItem` without a catch. A quota/security exception interrupted the frame after updating in-memory counts, leaving fishing in `bite`; another E could repeat the award. Rice harvest and mango collection could also throw midway through their updates. `Save.reset` similarly aborted before `newGame` if storage removal failed. | Fixed: persistence failure leaves in-memory gameplay transitions intact. Tests: complete a real catch with throwing storage, press again without duplicate award, return to idle; reset with blocked storage. |
| ISSUE-04 — Make microphone and voice-send ownership explicit | P1 | Mic union, ended-track handling, per-attempt send ownership, stale room callbacks | `setTalking(true)` only required non-null `stream`: ending its track left `talking=true` and the dead stream prevented reacquisition. `addStream` in installed `@trystero-p2p/core/dist/media.mjs` awaits metadata before adding tracks. Muting/moving away during that await removed tracks too early and cleared `sending`; late success then attached an untracked send, so later exclusion sweeps never removed it. `syncSend` also added peer IDs to `sending` immediately, then swallowed `addStream` rejections; later refreshes never retried that peer. Old room stream callbacks remained accepted during the asynchronous leave window; post-leave safety additionally relies on library callback suppression without app ownership guards. Pending permission rejection could also mutate microphone state after permanent disable. | Fixed: explicit mic states, ended → released, guarded permission completion, late cancelled additions compensated after settlement, failed sends made retryable, completion ownership scoped to room/stream/attempt, callbacks scoped to current room. Tests: release while permission pending; repeated press; track end/reacquire; success and rejection after disable; failed negotiation retry; old rejection cannot erase newer attempt; late success after mute/device release removed; stream after detach/rejoin ignored. The mute race uses the installed media manager, not a guessed async order. |
| ISSUE-03 — Separate relay discovery from peers and serialize recovery | P2 | Net relay status, retry guard, callback generations, Voice detach, HUD | `checkRelays` changed to offline only from `connecting`; after `online`, closing every relay left it online forever. After one recovery `retried=true` permanently suppressed future recoveries. Callbacks installed by `start` captured only `this`: old-room events during its 99 ms asynchronous leave window still updated the retiring generation. Post-leave callback isolation is additional defense, not a separately proven third-party failure. The old watcher also ran across asynchronous leave. | Fixed: online → connecting → offline after 12 s of continuous relay loss; connected peer count still takes HUD precedence. Every offline period may retry; overlapping events coalesce. Invalidate old callbacks and stop the watcher before awaiting leave; detach voice immediately. Tests: relay loss/recovery; existing peers retained; overlapping and successive retries; delayed old-room join/leave ignored. |
| ISSUE-06 — Cancel input ownership on focus/pointer loss | P2 | Input reset; TouchControls gesture reset | Blur cleared only keyboard keys. Queued E/C/Z and virtual movement survived, so a queued action or held joystick could act after returning without a new press. Mouse pointer cancellation never reset `dragging`, so later uncaptured motion could orbit. | Fixed: blur resets held/queued input, deltas, joystick and drag; touch tracking also resets; pointercancel/lostcapture end mouse drag. Tests: queued action, joystick, accumulated look, cancelled pointer, held-gamepad focus recovery and touch ownership reset. |
| ISSUE-05 — Keep bird visit deadlines across hops | P3 | Arrival versus hop lifecycle | `perchBird` started a hop every 3–7 s; `moveBird` reset `stayLeft` to 25–45 s after every landing. The 25–45 s deadline could never expire in an undisturbed flock. | Fixed: initial arrival alone starts the visit deadline; it continues during hops. Test: repeated landings preserve deadline and eventual update enters flee. |
| ISSUE-07 — Invalidate presentation state when its owner changes | P3 | Full-map cache; scarecrow island cleanup; Fishpedia typing guard | Opening FullMap while `IslandShapes.bake` was awaiting row slices cached an image without completed land shapes. Only visited-count changes invalidated it, so completion alone never redrew the land. A scarecrow's DOM bubble outlived its island because only live interactables ticked its timer. F in other text inputs could also toggle Fishpedia while typing. | Fixed: bake-ready edge invalidates the open map cache; outgoing scarecrow animation/bubble is explicitly cleared; F uses the shared editable-field guard. Tests: ready edge rebuilds once; scarecrow interrupted spin/bubble cleared; editable F suppressed. |
| ISSUE-08 — Reset consecutive slow windows across excluded work | P3 | Quality frame monitor | `pause()` reset the current window but retained `bad`. Main's hidden-tab path calls `pause`, not `tick(..., true)`. Two bad windows, a long hidden/island-change pause, then one bad window could trigger downgrade even though the windows were not consecutive across the excluded period. | Fixed: pause clears the bad-window streak. Test: two previous bad windows plus pause and fewer than three new bad windows do not request downgrade. |

Priority meanings: P1 can prevent play or break frame/award transitions; P2 affects connection recovery, voice, or unintended input; P3 affects bounded lifecycle or presentation behavior. Ordering within a priority is qualitative; no production incident frequency is assumed.

## Runtime and world machines

### 1. Boot, start overlay, and frame eligibility

Owners: [main](src/main.ts), [Loading](src/ui/Loading.ts), [LookControls](src/player/LookControls.ts).

States: initializing → warming → ready → playing; initialization failure → failed. The loading overlay has a fading/removal phase after start. Within ready, returning visitors start with a compact identity card; Edit expands it. A first-time visitor starts expanded. Visibility is an independent visible/hidden gate.

Invariants: input-driven gameplay and networking start only after the start promise resolves; renderer may run behind ready overlay; start resolves once and dispatches `game:start` once; Enter/Space in the name input or on Edit does not start play. Hidden frames do not draw or run gameplay. Overlay removal is delayed 620 ms; gameplay starts before removal.

| From | Event / guard | To / effect |
|---|---|---|
| initializing | renderer, physics, assets finish | warming; restore world/save |
| initializing/warming | rejected boot operation | failed; error message |
| warming | both kinds/proxies rendered, renderer setup complete | ready; enable start button |
| ready | click or allowed non-repeat Enter/Space | playing; resolve promise, dispatch start, fade overlay |
| playing | repeated start input | unchanged; `started` guard |
| compact identity | Edit | expanded identity, stays expanded |
| visible | `document.hidden` | hidden gate; pause quality measurement, skip frame |
| hidden | visible again | resume same world; elapsed simulation dt capped at 0.1 s |

No additional confirmed boot race is claimed. Parallel loading progress can be non-monotonic; the progress label is not a completion gate.

### 2. Live island, saved progress, and local coordinate frame

Owners: [main.enterIsland](src/main.ts), [Archipelago / IslandStates](src/world/Archipelago.ts), [Physics](src/core/Physics.ts), [Scatter](src/world/Scatter.ts), [Proxies](src/world/Proxies.ts).

States: unplaced → live island ID; synchronous switching transaction between live IDs. Progress is absent/fresh or captured/restored per island; the two kind-level visual objects are reused. A collider is enabled/disabled by active tag and corridor hiding. Each proxy is unbuilt, hidden, or visible; terrain detail is full/decimated independently.

Invariants: after `enterIsland` returns, current ID, live root, ground, colliders, interactions, fishing zones, and player frame agree; the live island's proxy is hidden; bridge corridor props have hidden visuals and disabled colliders. Shift preserves world-space player/camera position. Pickups, fishing, rain ripples, crop puffs and outgoing scarecrow DOM belong to one island and are cleared at the boundary. `setCurrent` listeners run during switching, not after the whole transaction; current listeners only update UI. New listeners must not assume physical switching has completed.

| From | Event / guard | To / effect |
|---|---|---|
| unplaced | restore or default spawn | live ID; don't capture an uninitialized world |
| live A | teleport/map-independent dev switch to valid B | capture A; load B; reposition player, snap rig |
| live A | bridge crossing into B | capture A; load B; shift player/rig by centre delta |
| live | new game | clear captured progress; enter main fresh |
| progress absent | enter | fresh tree/crop state |
| progress saved | valid compatible record | restored state |
| progress corrupt/incompatible | load/enter | reject record or use fresh crop layout; ISSUE-01 |
| proxy unbuilt | first in-range/warm request | build shared geometry copy |
| proxy hidden/visible | live ID or quality window changes | recompute visibility and placement; never show current island proxy |
| full/decimated terrain | quality changes | swap shared geometry reference |
| corridor prop visible | bridge corridor contains instance | hide transform and disable collider; inverse on corridor removal |

### 3. Save lifecycle

Owner: [Save](src/core/Save.ts).

States: unread → missing/unsupported or restored v1/v2; autosave inactive → active. Storage availability is an external independent writable/unavailable condition. Reset changes live state regardless of storage availability. Corrupt nested records are rejected atomically per island, not by discarding every otherwise valid island.

| From | Event / guard | To / effect |
|---|---|---|
| unread | parse/version failure | no restore; caller uses default spawn |
| unread | v1 or v2 | validate scalars, migrate legacy island IDs if needed; enter restored island |
| inactive | `start()` (one production call) | autosave every 5 s plus hide/pagehide writes |
| active | save event | capture live progress, serialize; ignore storage failure |
| any live state | reset | attempt remove; reset clock/player/camera/progress even if blocked |

Invariant: bad persisted data must not throw during boot (ISSUE-01); persistence failure must not interrupt gameplay (ISSUE-02). `start()` is not a general restart/dispose API; production calls it once. Multiple direct console calls are not presented as a reachable application bug.

### 4. Player pose, locomotion, and character animation

Owners: [Player](src/player/Player.ts), [CharacterModel](src/player/CharacterModel.ts), [CameraRig](src/player/CameraRig.ts).

Pose states: stand/sit/lie. Locomotion animation states: idle/walk/run when standing, idle clip with procedural pose when seated/prone. Movement gating (normal/fishing-locked) is independent of pose; ground support (grounded/airborne) controls vertical velocity. Camera desired arm versus collision-shortened arm is a continuous follow controller, not a separate discrete gameplay mode.

Invariants: movement intent stands the player up; sit and lie are exclusive target poses; CharacterModel waits for the opposite blend below 0.01 before increasing a new pose blend (small residual overlap below threshold is allowed). Physics update → step → sync order is preserved. Deep-water entry is blocked but an already submerged player may escape along non-descending ground. Facing output can be caller-owned to avoid allocation.

| From | Event / guard | To / effect |
|---|---|---|
| stand | C / Z | sit / lie |
| sit / lie | same pose toggle | stand |
| sit / lie | opposite pose toggle | other pose; blend through nearly standing |
| sit / lie | movement intent magnitude > 0.01 | stand |
| standing animation | speed < 0.3 / < 5.5 / otherwise | idle / walk / run; missing clip falls back to idle |
| grounded | movement update | small downward push for snap-to-ground |
| airborne | movement update | integrate gravity |
| any | restore/teleport | ground/bridge placement, reset vertical velocity |
| camera unblocked/blocked | ray hit or hit clears | shorten quickly / extend slowly, bounded by desired distance |

### 5. Graphics quality and adaptive monitor

Owners: [Quality](src/core/Quality.ts), [QualityMenu](src/ui/QualityMenu.ts), main.

Tier: high/medium/low. Source: URL/saved/auto/manual. Effective scene is built with fixed knobs plus live knobs; reload-needed is derived from fixed knobs differing from their built values. Frame monitor states: warmup/paused, measuring with 0/1/2 bad windows, downgrade requested then settling. A one-time mobile-WebGPU probe separately moves pending → hint/no-hint complete after 2 measured seconds.

| From | Event / guard | To / effect |
|---|---|---|
| uninitialized | initialize | URL tier wins, then saved, then device guess |
| any tier | manual choice / Q | selected tier; apply live knobs, save, recompute reload hint |
| high / medium | three consecutive 3 s windows below 40 fps | medium / low; pause 2 s |
| low | slow measurement | remains low; no upgrade path |
| measuring | hidden frame, island/tier change `pause()` | paused; reset window and bad streak (ISSUE-08) |
| paused | quiet deadline reached | measuring |
| measuring | frame > 0.2 s | exclude that sample |
| measuring | good window | bad streak = 0 |

Invariants: auto only moves downward; no performance claim is inferred from tier choice. A reload hint can remain after live changes because rice spacing, antialiasing and water shader are built at boot.

### 6. Clock, weather schedule, and rain effects

Owners: [DayNight](src/world/DayNight.ts), [Weather](src/world/Weather.ts), [Torches](src/world/Torches.ts).

Clock is continuous modulo 24, with speed=0 representing paused advancement. Rain schedule is now explicit: dry, storm(hoursLeft), forced. Intensity independently ramps toward 0/1 over 20 real seconds. Ripple pool slots are inactive/active; streak visibility follows intensity threshold. Night lighting is derived from clock/nightFactor, not a separate authoritative night flag.

| From | Event / guard | To / effect |
|---|---|---|
| clock time | update | advance by dt × speed; wrap into [0,24) |
| clock time | T / setTime / restore | change phase; manual jump does not itself add storm-duration hours |
| dry | roll deadline (4–8 game hours), probability < 0.3 | storm; sample 1–3 game hours |
| dry | failed roll | dry; sample next roll deadline |
| storm | remaining hours expire | dry |
| any rain schedule | force on | forced; no sentinel Infinity needed |
| any rain schedule | force off | dry; automatic schedule resumes |
| intensity | each frame | ramp toward schedule target; bounded [0,1] |
| ripple inactive | spawn requested, underwater point found | active with age/lifetime |
| ripple active | lifetime expires / intensity < 0.01 / island clear | inactive and hidden |
| torch group hidden/visible | night threshold crossed | derive flame/light visibility and select quality-limited nearby lights |

Invariants: forced rain never expires automatically; drying does not instantly remove rain. The roll countdown pauses during storms and forced rain, preserving existing scheduling semantics.

### 7. Incremental terrain-depth and map-image jobs

Owners: [Environment](src/world/Environment.ts), [IslandShapes](src/world/IslandShapes.ts), [FullMap](src/ui/FullMap.ts), [Minimap](src/ui/Minimap.ts).

States: depth job absent/building; shape images pending/partially baked/ready; full-map cache dirty/valid independently of open/closed.

| From | Event / guard | To / effect |
|---|---|---|
| depth absent/building | `setWindow` | replace job for latest centre; old partial data abandoned |
| depth building | frame update | bake limited rows into job-owned data |
| depth building | final rows | publish depth texture; job absent |
| shapes pending/partial | async row-slice completion | publish each kind image; after both set ready |
| map cache valid | visited count, layout, or shapes-ready edge changes | dirty → rebuild (ISSUE-07) |
| map closed | open | layout and rebuild current static layer |
| map open | update | redraw player marks over static cache |
| minimap | period elapsed | redraw directly from latest images; no static cache invalidation needed |

Invariants: a new depth job cannot publish obsolete window data; asynchronous shape readiness must invalidate an already open full map. Shape-bake rejection behavior is not changed here; actual canvas failure was not reproduced.

## Interaction machines

### 8. Interaction arbitration and fishing availability

Owners: [InteractionSystem](src/interact/InteractionSystem.ts), [FishingSpot](src/interact/FishingSpot.ts).

States: no eligible target / nearest eligible target / locked fishing owner; fishing spot unavailable/available depends on ground depth, shore/bridge and pose. Island interaction membership changes atomically at `setActive`; fixed fishing remains registered. The combined list is cached rather than allocated twice each frame.

| From | Event / guard | To / effect |
|---|---|---|
| no target / target | position, facing, pose or prompt changes | nearest usable in range; posed player gets no prompt |
| unlocked | fishing active | locked owner excludes every other prompt/action |
| target | E edge | execute chosen interaction once |
| any island membership | island switch | replace island entries; keep fixed entries |
| fishing idle | deep water ahead and shore/bridge at feet | available; classify pond/sea |
| available + standing | interact | start cast |
| active fishing | move or non-standing pose | request cancel/reel if cancellable |

### 9. Fishing session (explicit)

Owner: [Fishing](src/interact/Fishing.ts).

States: idle, casting, waiting, nibble, bite, caught, escaped, reel.

Invariants: active iff not idle; cancellable only during casting/waiting/nibble/bite; `bite` has a species and reaction deadline; awards happen exactly once on bite → caught; reel result states cannot accept another hook/cast; all non-idle phases hold movement until idle. Rod/line/bobber are hidden at idle; splash lifetime may continue, so idle ticks still drain splash effects. The hand/rod tip is computed at cast start before skipping idle transforms.

| From | Event / guard | To / effects |
|---|---|---|
| idle | cast | casting; resolve current tip, show line/bobber, timer=0 |
| casting | 0.7 s | waiting; sample 2–6 s wait and approach shadow |
| waiting | timeout | nibble; sample 1–3 fake dips |
| nibble | fake dip timer, dips remain | nibble; decrement counter and pause 0.5–0.9 s |
| nibble | no dips remain | bite; choose species and reaction window |
| casting/waiting | E | reel for 0.6 s |
| nibble | E | escaped, “too early” |
| bite | E | record catch + inventory, caught for 1.2 s; ISSUE-02 |
| bite | deadline | escaped for 1.2 s |
| any cancellable | movement/pose cancellation | reel |
| caught/escaped/reel | timer expires | idle; hide visuals, clear species |
| any | abort/island switch | idle; remove splashes and prompt marker |
| cancellable | dev force bite | bite; intentional debug shortcut |
| non-idle | cast request | ignored |

### 10. Fruit tree shake and regrowth

Owner: [FruitTree](src/interact/FruitTree.ts).

Shake states are now explicit: resting, beforeDrop(elapsed), afterDrop(elapsed). Fruit availability is a separate boolean array with cached count; missing fruit enables an independent 45 s regrow timer.

| From | Event / guard | To / effects |
|---|---|---|
| resting | interact and hangingCount > 0 | beforeDrop; sample 1–3 pending drops |
| beforeDrop | elapsed crosses 0.4 s | afterDrop; drop min(pending, available), hide fruit instances |
| afterDrop | elapsed reaches 0.8 s | resting; restore trunk rotation |
| any shake phase | restore island | resting; clear pending drops and restore fruit/timer |
| missing fruit | 45 s | restore one random missing fruit, reset timer |
| full fruit | update | reset regrow timer |

Invariants: one drop event per shake, even if a frame crosses both thresholds; cached count equals the number of true hanging entries; restoring/regrowing updates count through the same setter. Regrowth is orthogonal to shaking and can happen during it.

### 11. Rice growth, bending, harvest target, and puffs

Owner: [PaddyField](src/interact/PaddyField.ts).

Growth states use persisted codes: YOUNG=0, RIPE=1, STUB=2. Bend state is sleeping or active spring; proximity supplies a target independently of growth. `growing` indexes non-ripe stalks; `bending` indexes unsettled springs. Spatial cells are immutable after construction. Puffs are alive/expired and target is none or a ripe in-range facing stalk.

| From | Event / guard | To / effects |
|---|---|---|
| YOUNG | 60 s active-island time | RIPE; reset timer and paint |
| RIPE | chosen among 4–8 nearest eligible stalks | STUB; timer=0, height=0.15, award rice |
| STUB | <60 s | STUB; grow height and blend colour |
| STUB | 60 s | YOUNG; full height, reset timer |
| sleeping spring | within bend radius | active; lean away from player |
| active spring | out of range | integrate back toward upright |
| active spring | tilt and velocity <0.001 | sleeping, snap both to zero |
| any | compatible restore | load growth arrays, zero spring state, rebuild growing set |
| any | absent/incompatible density save | fresh layout; ISSUE-01 |
| puff alive | 0.9 s / clear island | remove/dispose |

Invariants: only RIPE is harvestable; all meshes share instance indices; growing and unsettled springs remain updated even far from player. Optimization must not make a distant crop stop growing or a spring freeze tilted. Regression runs 150 simulated seconds against full spatial scanning through harvest and settling. Growth remains paused while that island is inactive, matching prior behavior.

### 12. Bird arrival, visits and escape

Owner: [Birds](src/interact/Birds.ts).

Explicit states: move/perch/flee; move's implicit purpose is now distinguished by `arriving` (initial descent versus local hop). Absent is terminal removal. Flock scheduler is waiting → spawn attempt → waiting, every 20–40 s, capped at six birds.

| From | Event / guard | To / effects |
|---|---|---|
| absent | spawn capacity available | arriving move from sky |
| arriving move | curve complete | perch; initialize 25–45 s visit once |
| perch | hop deadline 3–7 s | move with arriving=false |
| hop move | complete | perch; retain remaining visit (ISSUE-05) |
| perch/hop | visit expires | flee |
| any not fleeing | scarecrow or player within 4 m horizontally | flee entire flock |
| flee | >40 m from paddy centre or 20 s | absent, remove root |
| any | clear/island switch | absent |

Invariant: hops cannot extend the visit deadline; arrival time is outside the visit budget. Fleeing birds are not scared again.

### 13. Fallen mango pickup

Owner: [Pickups](src/interact/Pickups.ts).

States: fall/rest/collect/removed.

| From | Event / guard | To / effects |
|---|---|---|
| absent | tree spawn | fall with velocity |
| fall | ground contact, fewer than two bounces and vertical impact <−1 | fall; bounce with energy loss |
| fall | settled contact | rest |
| rest | player distance <1 m | collect; remember start, update pitch streak |
| collect | 0.25 s | removed; award one mango |
| any | island clear | removed without award |

Invariant: a fruit awards only after collection completes, once; blocked storage cannot interrupt the update (ISSUE-02). Streak resets by elapsed time between collection starts, not by fruit identity.

### 14. Scarecrow spin and speech

Owner: [Scarecrow](src/interact/Scarecrow.ts).

Independent timed states: spin idle/spinning and bubble hidden/showing. A new poke restarts both, from the current yaw, and scares birds.

| From | Event / guard | To / effects |
|---|---|---|
| any | poke | spinning + showing; choose a different line |
| spinning | spin duration | idle; restore yaw, remove wobble |
| showing | bubble duration | hidden |
| any | outgoing island cleanup | both idle/hidden; restore interrupted rotation (ISSUE-07) |

## Networking and audio machines

### 15. Discovery lifecycle, retry transaction and room identity

Owner: [Net](src/net/Net.ts).

Discovery status is explicit `off/connecting/online/offline`. It describes relay discovery, not whether an existing P2P connection still works. Lifecycle fields distinguish start not requested, starting/joined, and retry in flight. A generation token owns every room callback. Public/private identity is fixed for a page load; switching identity saves then reloads.

| From | Event / guard | To / effects |
|---|---|---|
| off | start, solo=false, not already started | connecting; import Trystero, derive private keys if needed, join, attach actions, start watcher |
| off | solo=true | off; no networking |
| starting/joined | repeated start | unchanged |
| connecting/offline | at least one relay opens | online; reset continuous-loss timer |
| connecting | 12 s with no initial relay | offline |
| online | all relays close | connecting; begin 12 s continuous-loss timer |
| connecting after loss | 12 s with no relay | offline |
| starting | import/derive/join setup throws | offline |
| offline + not retrying | browser online event | retry in flight; invalidate generation, stop watcher, detach voice and clear old peer/action references, await old leave |
| retry in flight | another online event | ignored; one retry owner |
| retry in flight | leave settles (rejection swallowed) | start new generation; release retry guard when start finishes |
| offline after later failure | later online event | new retry allowed (ISSUE-03) |
| public/private | create/join private or leave private | save + change URL/storage + reload; no in-place room mutation |
| joined | pagehide | request room leave |
| any | callback from obsolete generation | ignored |

Invariant: one owned generation updates peers; concurrent retries cannot create multiple joined generations. Existing peers are retained through relay loss, and the HUD displays them rather than claiming the entire game is offline. Rejoin intentionally clears old peers. There is no claim that an open socket proves relay delivery or successful P2P connectivity.

### 16. Peer presence, snapshots, chat and avatar rendering

Owners: Net and [RemotePlayers](src/net/RemotePlayers.ts).

Per-peer connection state: absent/connected; failed signalling is a separate diagnostic set that can exist without a connected peer. Presence: no snapshot/fresh/stale. Avatar: absent/visible/hidden-cached. Identity/look and pose are independent attributes. Send cadence: moving >0.1 m/s sends at 10 Hz, otherwise 2 Hz, with a minimum 0.1 s spacing for discrete changes.

| From | Event / guard | To / effects |
|---|---|---|
| absent | current-room peer join | connected, default identity; send hello |
| diagnostic failure | peer join/leave | clear failure entry |
| connected | valid state message | fresh; append snapshot and prune older than 1 s except newest two |
| no snapshot/fresh | no updates for 15 s | stale; remove avatar, keep connection |
| stale | new valid snapshot | fresh, recreate avatar if selected |
| connected | leave | absent; renderer/voice clean up on their next update |
| connected | validated hello | replace name/look |
| connected | valid chat and ≥1.5 s since prior accepted chat | show message |
| avatar absent/hidden | fresh, in proxy window, nearest 24 | visible, create/reuse model |
| avatar visible | out of window or beyond render cap | hidden-cached |
| avatar any | peer absent/stale/no snapshots | absent; dispose model/DOM |

Invariants: malformed state/identity does not bypass validation; interpolation uses consistent island-centre coordinates and shortest heading arc. Candidate selection uses squared distance, stable ties, reused samples/buffers; no more than 24 avatars are placed. Received chat can create a hidden avatar before a snapshot; it becomes visible only through normal rendering selection.

### 17. Microphone resource ownership (explicit after refactor)

Owner: [Voice](src/net/Voice.ts).

Microphone states: released, acquiring, ready(stream), talking(stream), blocked, disabled. `wantTalk` remains independent user intent so release during a permission prompt is remembered. Hold/open mode, receive mute, volume and peer mute are orthogonal settings. “Talking” means enabled microphone transmission intent, not detected human speech.

| From | Event / guard | To / effects |
|---|---|---|
| released | press | acquiring; request mic synchronously in gesture |
| acquiring | another press | acquiring; no duplicate request |
| acquiring | release | acquiring; wantTalk=false |
| acquiring | permission success, same request, still enabled | talking if wantTalk, otherwise ready with track disabled |
| acquiring | permission rejection, same request | blocked; clear intent |
| ready | press | talking, enable audio track and send speaking flag |
| talking | release, blur or mode change | ready; disable track, send off, start idle deadline |
| ready | >30 s no talk requested | released; remove stream from peers, stop tracks |
| ready/talking | track ended | released; clear intent and stop/remove stream (ISSUE-04) |
| enabled states | permanent feature failure | disabled; stop mic, drop receive graph, remove controls |
| disabled | pending permission resolves | disabled; stop returned tracks without adopting them |
| disabled | pending permission rejects | disabled; ignore completion |
| blocked | press | blocked; no permission retry until page reload |

Invariants: only ready/talking own a stream; only talking enables it; disabled is absorbing; late permission completions cannot restore disabled resources. The blocked-until-reload policy is preserved, not classified as a new permission-retry bug. Permission release/success/disable interleavings are covered with controlled promises.

### 18. Voice send membership and room attachment

States per peer: excluded, adding/registered attempt, eligible-to-retry; tracked in `sending` plus attempt ownership. Room states: detached/attached. Membership includes pending negotiations (it is not proof of successful media delivery).

| From | Event / guard | To / effects |
|---|---|---|
| excluded | fresh, unmuted, not failed, ≤20 m and under cap | register owned attempt, call addStream |
| registered | still selected, ≤24 m hysteresis | keep; no duplicate add |
| registered | removed by distance/cap/mute/staleness/failure | removeStream, clear membership; pending attempt stays owned until settlement |
| registered | matching room/stream/attempt rejects | remove partially added tracks, clear attempt/membership; next 0.5 s refresh may retry |
| cancelled pending attempt | late success | compensate with removeStream after addition, clear attempt; no duplicate add while cancellation is pending |
| registered | obsolete rejection after drop/rejoin/new attempt | ignore; cannot erase replacement attempt |
| attached | network detach/retry | detached; clear sends, pending streams, receive links and speaking indicators |
| detached | new room | attach actions/stream callbacks owned by this room |
| any | microphone released | remove sends and stop tracks |

Invariant: late success cannot leave an untracked stream sending to an excluded peer; asynchronous failure cannot leave a peer permanently marked as successfully scheduled; stale completions cannot mutate new ownership. Send cap and range policy are implemented by `selectAudioPeers` and already have hysteresis/cap regression tests.

### 19. Received voice, audio context availability and speaking indicators

States per stream: absent/pending-context/linked/disposed. A linked stream owns a muted detached audio element plus source/gain/panner/analyser. Speaking indicator is the union of a fresh `vc` flag (<2.5 s) or detected RMS held for 0.5 s; session mute suppresses the indicator. Local speaking keepalive repeats every 1 s.

| From | Event / guard | To / effects |
|---|---|---|
| absent | current-room stream, context not ready | pending-context |
| absent/pending | context ready | linked; build graph |
| linked | identical stream callback | unchanged |
| linked | replacement stream | dispose old graph, link new stream |
| pending/linked | peer leaves, room detaches, or feature disabled | dispose/remove |
| linked | peer fails | tear down on 0.5 s sweep |
| linked | gain update (0.1 s) | smooth distance attenuation/pan; stale or muted → target gain 0 |
| indicator off/on | valid vc / RMS / expiry / mute | recompute indicator |

Invariants: callbacks from old rooms cannot create pending or linked resources after detach. Incoming network streams are not stopped by the receiver; it owns playback nodes, not the sender's device. No actual WebRTC/audio device performance has been measured by this test suite.

### 20. Game audio unlock, samples, and ambience

Owners: [AudioManager](src/audio/AudioManager.ts), [Ambience](src/audio/Ambience.ts), Synth.

Independent states: context absent/suspended/running; samples loading/settled (each loaded/failed); mute on/off; ambience not-started/started. AudioContext closed is a browser lifecycle state without an app recreation path; no production call closes it here.

| From | Event / guard | To / effects |
|---|---|---|
| context absent | first gesture and supported constructor | create buses, synth and ambience; notify unlock listeners once |
| suspended | gesture | request resume |
| samples loading | every fetch/decode settles | settled; build variant groups; failed sample can use synth fallback |
| mute on/off | M or pill outside editable fields | toggle, save best-effort, ramp master gain |
| ambience unstarted | unlock initialization | started; persistent noise/buses, procedural scheduled calls |
| footstep stationary | measured speed >0.8 and stand pose | moving; emit at walk/run interval |
| footstep moving | slow or non-standing pose | stationary; reset step timer |
| footstep any | teleport/shift | discard old position so displacement is not a sprint |

Invariants: voice bus bypasses the game's master mute; volume/mute of received voice is independent. Unsupported or undecoded audio falls back/silences as coded. No new confirmed audio-unlock race was reproduced.

## Input and UI machines

### 21. Input ownership, edge queues and touch gestures

Owners: [Input](src/core/Input.ts), [TouchControls](src/ui/TouchControls.ts).

States: focused/unfocused with gameplay/typing independent; mouse drag idle/captured; each action unqueued/queued and pad previous-up/down; touch pointer untracked/stick/look. Touch look has orbit (one pointer) or pinch (two or more); at most one stick pointer exists.

| From | Event / guard | To / effects |
|---|---|---|
| gameplay | typing=true | typing; clear held keys/actions/touch motion |
| typing | close chat | gameplay |
| action unqueued | non-repeat keydown or touch button | queued |
| queued | consume | unqueued; true once |
| pad up | button down on consume | down; true once until release |
| mouse idle | allowed pointerdown | captured drag |
| mouse drag | up/cancel/lost capture | idle |
| any input | blur | unfocused; clear queues, keys, touch and drag state; ISSUE-06 |
| unfocused | focus | focused; sample held gamepad baseline so recovery does not synthesize an action edge |
| untracked touch | allowed canvas-zone down | stick if left and free, otherwise look |
| look one | second look down | pinch; initialize spread |
| pinch | fewer than two looks remain | orbit; reset pinch baseline |
| stick/look | up/cancel/blur | untracked; release joystick if stick |

Invariants: queued events are consumed once; cancellation cannot leave input owned by a gone pointer. Blur also clears TouchControls' tracking map, preventing a later move from reasserting a cancelled joystick. Typing gates movement/action/look consumption; global menu shortcuts use their own editable checks.

### 22. Chat composer and timed speech bubble

Owners: [ChatBubble](src/ui/ChatBubble.ts), [SpeechBubble](src/ui/SpeechBubble.ts).

Composer closed/open. Bubble idle/showing/fading; visibility from camera/range is independent of text lifetime.

| From | Event / guard | To / effects |
|---|---|---|
| composer closed | Enter/touch chat, no other editable owner | open; Input.typing=true; focus field |
| open | Escape, blur, canvas click | closed; release typing |
| open | Enter, not IME composing | close; empty → no send; /name or /nama → identity callback; otherwise local bubble + send callback |
| bubble idle/showing/fading | nonempty say | showing; cancel old timers, restart lifetime |
| bubble showing | text-dependent 3–9 s deadline | fading |
| bubble fading | +0.4 s | idle, display none |
| bubble any | destroy | clear timers/remove DOM |

Invariant: replacing a bubble cancels both old callbacks, so old expiry cannot hide new text. `destroy` is called only for removed avatars; reuse after destruction is not a production transition.

### 23. Fishpedia, catch card, inventory and toast lifetimes

Owners: [Fishpedia](src/ui/Fishpedia.ts), [Inventory](src/ui/Inventory.ts).

Fishpedia closed/open; catch card hidden/showing; each species absent/recorded; inventory is item counts, each toast entering/showing/exiting/removed.

| From | Event / guard | To / effects |
|---|---|---|
| Fishpedia closed/open | F outside typing / touch button | toggle panel |
| species absent/recorded | catch | increment count, update biggest; persist best-effort |
| catch card any | new catch | showing; replace text, cancel old hide timer |
| catch card showing | 2.6 s | hidden |
| inventory | add | update in memory, persist best-effort, render and spawn toast |
| toast new | animation frame | showing |
| toast showing | timeout | exiting, then remove DOM |

Invariant: failed storage cannot abort an award transition. Inventory and Fishpedia remain separate localStorage records; there is no crash-atomic cross-key transaction or cloud persistence guarantee.

### 24. Menus and asynchronous clipboard/share feedback

Owners: [QualityMenu](src/ui/QualityMenu.ts), [RoomMenu](src/ui/RoomMenu.ts), Voice menu, [FullMap](src/ui/FullMap.ts).

Each menu independently closed/open. Quality hint absent/needs-reload. Room copy idle/pending/copied or fallback-field; share pending/settled. These menus are not mutually exclusive by a central modal machine.

| From | Event / guard | To / effects |
|---|---|---|
| closed | pill / map toggle | open; reflect aria-expanded where applicable |
| open | Escape, own toggle, outside click | closed |
| quality hint any | apply tier | recompute mismatch with boot-built knobs |
| room copy idle | copy click | pending clipboard promise |
| copy pending | success | copied label, restore after 1.5 s |
| copy pending | rejection | show/select invite field |
| share | browser share promise settles/rejects | no room transition; rejection ignored |
| public room | create confirmed in UI | save and reload private room |
| private room | back | save and reload public room |

Invariants: invite secret stays in URL fragment; room switch is a reload boundary. Overlapping clipboard clicks can produce short-lived label timing differences; no impact on room identity was demonstrated and this is not listed as a confirmed connection bug.

### 25. Island title, performance panel and diagnostic HUD

Owners: [IslandTitle](src/ui/IslandTitle.ts), [NetPill](src/net/NetPill.ts), [PerfPanel](src/ui/PerfPanel.ts), NetDebug.

Island title hidden/showing/fading; each show cancels previous removal. Net HUD is derived from connected peers first, then discovery connecting/offline, failure diagnostics, or zero peers; private prefix is independent. Performance/diagnostic panels are enabled by startup flags, not dynamically mounted/unmounted gameplay modes.

| From | Event / guard | To / effects |
|---|---|---|
| title any | arrival | replace title, restart CSS transition/timer |
| title showing | SHOW_MS−FADE_MS | remove show class, fade |
| HUD | 0.25 s refresh | derive current text and failure-help affordance |
| failure help hidden/showing | click while failures with no peers | toggle |
| failure help any | failures no longer displayed | hidden |
| perf/diagnostics enabled | frame / periodic sample | update counters; no gameplay state mutation |

## Optimization work associated with the audit

| Area | Implemented | Behavioral protection |
|---|---|---|
| Paddy | Spatial cells for nearby interactions; index growing crops and unsettled springs; do not scan distant resting ripe crops for bending | 150-second full-scan comparison through harvest, growth and settling; restore resets indexes |
| Fishing | Idle skips rod world transforms and line-buffer uploads; resolve tip on cast | Idle effect-drain test; first cast after position change; active cast reentry guard |
| Remote avatars | Reuse candidate/sample/shown buffers, squared-distance stable bounded insertion instead of full sort + slice | 40-peer closest-24 comparison and output reuse; existing interpolation semantics retained |
| Trees | Explicit shake phases and cached hanging count | Drop once across thresholds; count matches drops, restore and regrowth |
| Player / interactions | Reuse movement/facing vectors; cache fixed + island interaction list | Type checking, gameplay tests; `getFacing()` without an argument remains compatible |
| Weather | Explicit schedule union replaces boolean + Infinity combination | Forced never expires; storm expiration returns to dry; fade remains independent |

No FPS or memory-speedup percentage is claimed. These changes eliminate identifiable work; on-device profiling with `?perf`, real WebGPU/WebGL render output, and two-client voice/network checks remain outside the automated verification performed here.

## Verification and maintenance

- `npm test`: **43 tests passed**, including 25 new state-machine/optimization regressions in [tests/state-machines.test.mjs](tests/state-machines.test.mjs) and the existing room, voice-math and world regressions.
- `npm run build`: TypeScript strict checking and Vite production build passed.
- SSR tests disable HMR sockets; the controlled Trystero adapter does not contact real relays. Permission/negotiation races use manually settled promises. Tests execute production class methods, not copies of proposed reducers.
- UI tests use a minimal DOM fixture; this does not verify CSS transitions, real browser pointer capture, microphone permission UI, GPU performance, or actual WebRTC interoperability.
- Update this file when adding a state, event, owner, retry policy, or lifecycle boundary. Keep confirmed issue evidence, fix status and regression names together. A suspicious boolean combination alone is not evidence: supply a reachable call/event trace, including ownership and asynchronous ordering.
