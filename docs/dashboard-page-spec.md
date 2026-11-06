# Orbit "Client projects" page: consolidated spec

Ye file sirf us page ke liye hai jo sab cards ki list dikhata hai (header, Recent, Pinned, Projects). Expanded card ke andar ka Dashboard, sidebar, chat, Settings isme nahi hain.

Tags (har line par):
- [YOU SAID] tumne apne message mein bola
- [CURRENT] tumhare Orbit UI doc ya screenshots mein pehle se hai
- [MY DECISION] maine tay kiya; galat lage to badal do
- [OPEN] tumne bataya nahi; agent ko guess nahi karna, tumse poochna hai

---

## 1. Jo tumne bola (requirements)

1. [YOU SAID] Header ka "..." button hata do (uska dropdown: Collapse all / Expand all / Sync all). Uski jagah sirf ek simple button "Sync all". Koi dropdown nahi.
2. [YOU SAID] "Sync all" button [Compact | Expanded | Mixed] ke baad aaye.
3. [YOU SAID] Compact card abhi se bada (agar abhi 1 hai to 1.5) ho, aur usme saari important cheezein bahut chhote tareeke se dikhein.
4. [YOU SAID] Filter buttons: All, Urgent, Inactive (24 ghante se koi message nahi).
5. [YOU SAID] Sabse upar Recent: urgent aur recent cards.
6. [YOU SAID] Har card mein ek Pin button. Pin karne par card Recent ke baad, "Pinned" heading ke neeche dikhe.
7. [YOU SAID] Pinned cards ka sequence kabhi apne aap nahi badle. User unhe manually upar-neeche (drag) kar sake.
8. [YOU SAID] Pinned ke liye "urgent upar" ka koi rule lagu nahi hota. Urgent-top sirf Pinned ke baad wali list par lagu hai.
9. [YOU SAID] Pinned heading ke baad All / Urgent / Inactive buttons aur baaki saare cards.
10. [YOU SAID] Page ka top aur poora look clean, premium, aur good-looking ho.
11. [YOU SAID] Compact / Expanded / Mixed rahe.

## 2. Abhi kya hai (doc + screenshots se)

- [CURRENT] Header: "Client projects", muted line "N project · Synced Xm ago · Every 5 min", right par segmented [Compact | Expanded | Mixed], "..." button, "Settings", "New project" (primary).
- [CURRENT] Neeche: slim banner "Global setup pending ...", phir digest line "Across workspaces <topPriority>" (sab workspaces ka ek sabse urgent kaam, max 20 words).
- [CURRENT] Compact card ek row hai: left status accent bar, project name, workspace chip, client, status chip, situation line, "1 question" chip, "Needs reply", progress bar + %, last contact age, "...", chevron.
- [CURRENT] View modes: Compact = sab compact, Expanded = sab expanded, Mixed = har card ka apna state yaad rahe. Choice localStorage 'orbit.view' mein.
- [CURRENT] Recent mini-card (236px, max 6, har project ka ek item): workspace pill, status chip, project name, one-line (2 lines clamp), flags (reply / delta / age / #channel). Click par us project card tak smooth scroll + flash. Pehle All / Urgent / Inactive chips Recent ke header par the.
- [CURRENT] Urgent = needsReply ya status blocked ya status at-risk. Inactive 24h+ = pichhle 24h se kisi ne message nahi kiya.
- [CURRENT] Recent ka importance score: (needsReply ? 35 : 0) + (urgency high ? 15 : 0) + statusWeight (blocked 30, at-risk 24, waiting-on-client 20, on-track 8) + 20 x e^(-hoursSince / 12) + min(15, newMessages) - (hoursSince >= 48 ? 10 : 0). Sort score desc, tie par newest.
- [CURRENT] Page har 60 sec snapshot refresh karta hai. Sync interval 300 sec.
- [OPEN] Tumhare latest screenshots mein Recent strip dikh nahi rahi (doc ke hisaab se items na hon to hide hoti hai). Ye bug hai ya items nahi the, ye agent ko pehle dekhna hai.

## 3. Target page (upar se neeche)

```
 Client projects                      [Compact|Expanded|Mixed] [Sync all] [Settings] [New project]
 4 projects · Synced 3m ago · Every 5 min

 | Across workspaces  Reply to the client confirming start ...           (digest, as now)
 (slim banner: Global setup pending ..., sirf jab pending)

 Recent                                                    (koi chips nahi)
 [mini][mini][mini][mini]   -> horizontal strip, max 6

 Pinned  2                                                 (sirf jab >= 1 pinned)
 [grip][ pin* Card A ......................... Sync > ]   manual order, up/down/drag
 [grip][ pin* Card B ......................... Sync > ]

 Projects  3                         [All 3] [Urgent 1] [Inactive 24h+ 1]
 [ pin  Card C ............................... Sync > ]   urgent upar, phir importance
 [ pin  Card D ............................... Sync > ]
```

## 4. Behaviour rules

Header
- [YOU SAID] "..." menu nahi. Right side order: segmented control, "Sync all", "Settings", "New project".
- [MY DECISION] Sync all chalte waqt "Syncing 2/5" dikhaye aur disabled ho. Error par ek hi muted error line. Schedule paused ho to button par chhota "Paused" hint.
- [MY DECISION] Collapse all / Expand all alag controls nahi: Compact = sab collapse, Expanded = sab expand.

Recent
- [YOU SAID] Sabse upar, urgent + recent cards. Click par card khule (section 5B).
- [MY DECISION] Wahi mini-card design (max 6, ek project ek item, wahi importance score). Isme All/Urgent/Inactive chips nahi, wo Projects section mein gaye (kyunki tumne chips ko Pinned ke baad rakhne ko bola).
- [MY DECISION] Pinned project bhi Recent mein aa sakta hai, chhote pin icon ke saath. Recent koi order nahi todta.
- Item na ho to section hide.

Pinned
- [YOU SAID] Heading "Pinned" (count ke saath), sirf jab kam se kam 1 pinned ho.
- [YOU SAID] Order sirf user ka manual order. Sync, urgency, inactivity, filters, kuch bhi isse nahi chhedta.
- [MY DECISION] Naya pin list ke bottom mein jaye. Unpin par card Projects list mein wapas aaye.
- [MY DECISION] Reorder 3 tareeke se: drag handle (grip, pointer based, drop indicator line, edge par auto-scroll), keyboard (handle par focus + Alt+Up / Alt+Down), aur card ke menu mein "Move up / Move down". Drop ke turant baad order save (restart ke baad bhi wahi).
- [MY DECISION] Pinned cards ka bhi view mode (Compact / Expanded / Mixed) Projects wale cards jaisa hi chale.

Projects (baaki cards)
- [YOU SAID] Heading ke saath All / Urgent / Inactive buttons.
- [MY DECISION] Chips ke counts sirf unpinned cards ke. Filter ka choice localStorage mein ('orbit.filter').
- [YOU SAID] Urgent cards sabse upar. [MY DECISION] Uske andar order importance score (upar wala formula) se.
- Filter par koi card na mile to ek muted line "Nothing matches this filter."

Pin button
- [YOU SAID] Har card mein pin button. [MY DECISION] Compact aur expanded dono ke header mein, icon button (outline = unpinned, filled + accent = pinned), tooltip "Pin" / "Unpin".

Compact card
- [YOU SAID] ~1.5x bada, saari important info chhote form mein. (Detail design ke liye section 5A dekho; wo is section ke compact bullets ko replace karta hai.)
- [MY DECISION] "1.5x" ko literal scaling nahi, balki zyada padding + height + typography + ek-do aur rows ki tarah samjha. Contents: Row 1: pin, project name, workspace chip, client, status chip, "Needs reply", "Inactive 24h+" (sirf true hone par), Sync, Expand. Row 2: situation line (bada, max 2 lines) + muted "Just changed". Row 3: Next step. Right zone: progress ("—" jab data nahi), pace, last 7 days mini bars, "Client 3h ago · Me —". Bottom chips (sirf non-zero): questions, blockers, risks. Chip click par card expand hoke us page par khule. Duplicate bottom "Expand" button nahi.
- Koi fake 0 ya placeholder number nahi; data na ho to "—" ya muted line.

## 5. OPEN: tumse jawab chahiye

1. Recent mein pehle All/Urgent/Inactive chips the. Tumhare message se maine unhe Pinned ke baad wale Projects section mein rakha. Sahi hai, ya Recent mein bhi rakhne hain?
2. Compact card "1.5x": literal bada kyun chahiye (kya kuch kat raha hai, ya sirf bharaa hua dikhna chahiye)? Maine bharaa hua + zyada info samjha.
3. Kya pinned card Recent mein dikhna chahiye? Mera default: haan, pin icon ke saath.
4. Pinned cards ki koi maximum limit chahiye? Mera default: koi limit nahi.
5. Sync all par ek card fail ho jaye to baaki cards ka sync na ruke (mera default). Theek?

---

## 5A. Compact card: naya design (section 4 ke compact bullets ko replace karta hai)

Abhi compact card bahut kam dikhata hai (naam, ek line, ek chip). Naya design teen tiers mein hai. Kuch bhi naya data invent nahi hota; har cheez wahi hai jo insight, metrics ya project state mein pehle se hai.

```
|▌ [pin] Project Alpha  [Workspace A]  Client A  (waiting-on-client)  [Needs reply]    [sync] [v]
|▌ Client asked to start; no work has begun yet.                 |  Progress   Pace          Last 7 days
|▌ Just changed · Client said "good" · 3h ago                    |  (ring)     12/30 days    ▁▃▅▂▇▄T
|▌ NEXT  Reply confirming start and ask for project details     |  42%        Behind pace
|▌ ----------------------------------------------------------------------------------------------
|▌ Your court · Client 3h ago · Me 1h ago · Reply time 2h  |  1 question · 1 risk · 3 new  | Tense | Updated 3m
```

Tier 1 (hamesha dikhe)
- Left status accent bar, pin, project name, workspace chip, client, status chip.
- "Needs reply" aur "Inactive 24h+" flags (sirf true hone par).
- Situation line (bada, max 2 lines). Source: insight.situationLine, warna snapshot.summary ki pehli line.
- "Just changed" (insight.recentLine) + us message ki age.
- Next step block (accent, 1 line). Source: insight.nextStep.
- Sync icon, Expand chevron.

Tier 2 (sirf data ho to; nahi to wo block hat jaye, khali box nahi)
- Progress: ring + %. Manual completion % pehle, warna agent estimate (sirf jab evidence ho), warna "—" aur muted "Not enough info".
- Pace: "12 of 30 days" + verdict (Behind pace / On pace / Ahead). Dates na hon to "No dates" aur ek chhota "Add dates" link (Settings kholta hai).
- Last 7 days: 7 mini bars (aaj accent), data na ho to bars ki jagah muted "No messages this week".
- Ball in court: "Your court" / "Client's court". Rule deterministic: lastClientAt > myLastReplyAt (ya me null) = Your court; warna Client's court. Client ka koi message hi nahi to chip nahi.
- "Client 3h ago · Me 1h ago" (lastClientAt, myLastReplyAt).
- Reply time: our median response time (kam se kam 3 pairs; warna hidden).

Tier 3 (chips, sirf non-zero)
- N questions, N blockers, N risks (click par card us detail page par expand ho; existing behaviour).
- N new (jo tumhari last visit ke baad aaya; lastViewedAt se).
- N/M deliverables (jab deliverables hon).
- Mood chip (Good / Neutral / Tense; "unknown" ho to hide). Tense par warning tone.
- "Updated 3m" (lastUpdatedAt). Expanded card ka AI badge compact mein nahi.

Fallback rules
- Koi fake 0, dummy %, ya placeholder text nahi. Data na ho to "—" ya muted line, ya wo block hide.
- Card ki min-height 124px; saari rows hide hon to bhi card toota hua na dikhe.
- Text truncate ho to full text tooltip mein.

Interaction
- [MY DECISION] Card ke khali hisse par click = card expand (chevron jaisa). Buttons, links, chips par click apna kaam kare, card expand na ho (stopPropagation). Card focusable ho; Enter / Space se expand.
- Hover par halka background aur chevron highlight. Pin aur Sync hamesha visible.
- Compact mode mein koi ek card expand karne par: [OPEN] mode "Compact" se "Mixed" mein jaye (mera default), taaki baaki cards compact rahein.

## 5B. Recent mini-card: naya design aur "click par card khule"

```
┌──────────────────────────────┐
│ [Workspace A]        [at-risk] │   pin icon (agar pinned) · New dot (agar naya)
│ Project Beta                   │
│ Deadline moved up; two         │   2 lines
│ deliverables still pending.    │
│ [At risk]  1d  #project-chat   │   reason chip · age · channel
└──────────────────────────────┘
```

- Width 250px (pehle 236), min-height 112px, scroll-snap, edge fade, hover par left/right arrows jab overflow ho. Max 6.
- [MY DECISION] "Reason" chip jo bataye ye card yahan kyun hai. Ye wahi score ke sabse bade hisse se nikalta hai: reply owed, blocked, at risk, waiting on client, warna "New activity". Kuch naya compute nahi hota.
- "New" dot sirf jab last visit ke baad kuch aaya ho.
- Pinned project ho to chhota pin icon.
- Purana "up/down arrow delta" sirf tab dikhe jab status badla ho; clutter kam.
- [YOU SAID] Click par card khule. [MY DECISION] click = us card tak smooth scroll + card expand + flash (1.4s). Pehle click sirf scroll + flash karta tha.
  - Mixed mode: wahi card expand ho (expandedIds mein add).
  - Compact mode: Mixed mein switch karke wahi card expand ho.
  - Expanded mode: sirf scroll + flash (sab pehle se expanded).
  - Card Pinned section mein ho to wahin expand ho; Projects mein ho aur filter ki wajah se hidden ho to filter "All" par reset karke dikhao.
- Keyboard: Tab se focus, Enter / Space = same as click, focus ring.

## 5C. Jo nahi badalna

- Expanded card (sidebar, Dashboard, Chat, Slack pages, Settings) bilkul nahi badalna. Tumne bola ye pehle se achha dikhta hai.
- Ek hi badlaav jo pehle approve ho chuka hai: expanded header mein pin icon. Uske alawa expanded card pixel-for-pixel same rahe. Shared CardHead ko badalna pade to variant prop se alag rakho, taaki expanded par asar na pade.
- Verification: expanded card ka before/after screenshot compare; diff sirf pin icon ka.

---

# 6A. Prompt for the coding agent: compact card aur Recent mini-card

```
ROLE
Tum Orbit ke codebase par senior engineer ho. Dashboard page ke sirf do cheezein improve karo: (1) compact card, (2) Recent mini-card aur uska click behaviour. Expanded card ko BILKUL mat chhuo (sirf pin icon jo pehle approve hua). Page structure (header, Pinned, Projects, filters, Sync all) is prompt ka hissa nahi hai.

PEHLE
1. Repo padh ke batao: CompactCard.tsx, RecentStrip.tsx, CardHead.tsx, ProjectCard.tsx, card-view.ts, recent-feed.ts ki current state (file:line), aur spec ke har item (neeche) ke saamne status: ALREADY DONE / PARTIAL / MISSING. Jo ho chuka hai dobara mat banao.
2. Chhota plan likho (files, naye pure functions, contract changes) aur dikha ke ruk jao. Approval ke baad phase by phase karo, har phase ek commit, typecheck + poora test suite + build ka asli output, aur .omc/status.md mein evidence (file:line / test naam) aur commit hash. Adhura ho to agle phase par mat jao. Ambiguous ho to guess mat karo, sawal likho.

PHASE 1: PURE SELECTORS (UI nahi)
- ballInCourt(lastClientAt, myLastReplyAt) -> 'yours' | 'client' | null.
- recentReason(item) -> 'reply-owed' | 'blocked' | 'at-risk' | 'waiting-on-client' | 'new-activity' (existing score ke sabse bade component se; tie ka order test mein fix karo).
- compactView(snapshot, metrics, viewedAt) -> tiers ke saath saare displayable fields, har field nullable. Koi invent nahi; data na ho to null.
- Tests: har field ka present/absent case, ball-in-court (client last, me last, me null, koi message nahi), reason selection, "new since last visit", reply time min 3 pairs.

PHASE 2: COMPACT CARD
- Spec ke Tier 1/2/3 ke hisaab se banao: accent bar, header row, situation + just changed, next step, right zone (progress ring / pace / last 7 days), footer row (ball in court, client/me ages, reply time, count chips, mood, updated age).
- Jo field null hai wo block hide ho (khali box nahi). Fake 0, dummy %, placeholder numbers nahi. min-height 124px. Truncate par tooltip.
- Click behaviour: card ke khali hisse par click = expand; buttons/links/chips par apna kaam (stopPropagation); card focusable, Enter/Space se expand; hover state.
- Pin icon (jo pehle approve hua) aur Sync/Expand header mein. Duplicate bottom Expand button nahi.
- Look: ek accent colour, kam borders, halka surface tint, consistent spacing/radius tokens. Dark aur light dono mein contrast check.

PHASE 3: RECENT MINI-CARD AUR CLICK-TO-OPEN
- Mini-card: workspace pill, status chip, pin icon (agar pinned), New dot, project name, 2-line summary, reason chip + age + #channel. Width 250px, scroll-snap, edge fade, overflow par arrows. Max 6.
- Click / Enter / Space: us card tak smooth scroll + expand + flash 1.4s. Mixed mode: expandedIds mein add. Compact mode: viewMode Mixed par switch karke expand. Expanded mode: scroll + flash. Card filter ki wajah se hidden ho to filter All par reset.
- Pinned section ya Projects section, jahan card ho wahin expand.

PHASE 4: TESTS AUR VERIFY
- Unit: Phase 1 ke selectors. Component (jsdom/testing-library): compact card sparse data (Agentwork jaisa: koi progress, koi dates) aur rich data dono par koi crash/khali box/fake number nahi; chips click expand ko trigger nahi karte; card click expand karta hai; Recent click ke teeno modes.
- Playwright agar harness hai: Recent click se card khule, keyboard se bhi.
- EXPANDED CARD GUARD: expanded card ka before/after screenshot (1100/1500/1900 widths), diff sirf pin icon ka. Jo diff mile report mein likho.
- Screenshots .omc/screenshots/ mein: compact sparse, compact rich, Recent strip, 3 widths.

RULES
- Koi data fabricate nahi. Existing store, dashboard-contract.ts types, code style follow karo. Naye/badle files mein lint errors zero.
- Page structure, sidebar, chat, Slack sync, Settings mat chhedo.

FINAL REPORT (isi chat mein)
Spec item table (item | status | evidence | commit), commits, typecheck/test/build ka asli output, naye tests, behaviour changes (Recent click ab card expand karta hai; Compact mode mein click par Mixed), expanded card ka diff result, screenshots ke paths, jo manually dekhna hai.
```

---

# 6. Prompt for the coding agent: page structure (copy karke do)

```
ROLE
Tum Orbit ke codebase par senior engineer ho. "Client projects" page (sab cards ki list) ko neeche ke spec ke hisaab se banao ya fix karo: header, Recent, Pinned (manual reorder), Projects (filters), aur compact card. Expanded card ke andar ke pages, sidebar, chat aur Settings ko mat chhuo.

PEHLE (premise check, code badalne se pehle)
1. Repo padh ke ek table banao: har spec item (neeche) ke saamne status: ALREADY DONE / PARTIAL / MISSING, evidence file:line ke saath. Pichhle prompts ka kuch kaam pehle ho chuka ho sakta hai (header, pin, filters). Jo ho chuka hai use dobara mat banao; sirf gap fix karo.
2. Recent strip tumhare latest screenshots mein dikh nahi rahi: pata lagao kyun (items nahi the, bug, ya hata di gayi) aur report mein likho.
3. Chhota plan likho (files, contract changes, migration) aur dikha ke ruk jao. Approval ke baad phase by phase karo; har phase ek commit, typecheck + poora test suite + build ka asli output, aur .omc/status.md mein evidence (file:line / test naam) aur commit hash. Adhura ho to agle phase par mat jao. Ambiguous ho to guess mat karo, plan mein sawal likho.

SPEC
HEADER
- Left: title "Client projects"; neeche muted "N projects · Synced Xm ago · Every 5 min".
- Right (is order mein): segmented [Compact | Expanded | Mixed], [Sync all], [Settings], [New project] (primary).
- "..." menu hata do. Collapse all / Expand all alag controls nahi (Compact = sab compact, Expanded = sab expanded, Mixed = per-card state).
- Sync all: sab projects sync (ek coordinated cycle agar SyncCoordinator ho, nahi to existing syncNow()); chalte waqt "Syncing 2/5" aur disabled; ek project fail ho to baaki na ruken; error par ek hi muted error line; schedule paused ho to "Paused" hint.
- Banner (Global setup pending) aur digest line ("Across workspaces ...") slim aur consistent rahein.

SECTIONS (upar se neeche)
1. RECENT: top ~6 items, har project ka ek (existing recent-feed score formula), horizontal strip, scroll-snap, edge fade. Koi filter chips nahi. Pinned project bhi aa sakta hai, chhote pin icon ke saath. Click par us card tak smooth scroll + flash. Item nahi to section hide.
2. PINNED: sirf jab >=1 pinned. Heading "Pinned" + count. Cards sirf user ke manual order mein; koi auto-sort, urgent-first ya filter lagu nahi. Naya pin bottom mein jaye. Unpin par card Projects mein wapas jaye. Order main-process dashboard store mein persist (pinnedOrder: string[]); deleted project ids hatao; unknown ids ignore.
3. PROJECTS: heading + chips [All N] [Urgent N] [Inactive 24h+ N]; counts sirf unpinned cards ke. Urgent = needsReply ya blocked ya at-risk ya urgency high. Inactive 24h+ = existing rule. Order: urgent upar, phir importance score. Filter localStorage 'orbit.filter'. Khali filter par "Nothing matches this filter."

PIN AUR REORDER
- Har card ke header (compact aur expanded) mein pin toggle (outline / filled accent, tooltip Pin / Unpin).
- Pinned mein drag handle se reorder: pointer-based, drop indicator line, edge auto-scroll, keyboard Alt+Up/Down (handle par focus), card menu mein Move up / Move down. dnd-kit jaisi lib repo mein ho to wahi, warna chhota custom; plan mein reason do. Drop ke baad turant persist. Restart ke baad order wahi.
- Pinned order kabhi automatically nahi badlega (sync, urgency, inactivity, filters se).

COMPACT CARD (~1.5x, bharaa hua nahi)
- Row 1: pin, project name, workspace chip, client, status chip, "Needs reply" aur "Inactive 24h+" (sirf true par), Sync, Expand.
- Row 2: situation line (max 2 lines) + muted "Just changed".
- Row 3: Next step (accent, 1 line).
- Right zone: progress ("—" jab data nahi), pace, last 7 days mini bars, "Client Xh ago · Me —".
- Bottom chips (sirf non-zero): questions, blockers, risks; click par card expand hoke us page par khule.
- Duplicate bottom Expand button nahi. Koi fake 0/placeholder nahi. Left status accent bar rahe.

LOOK
- Clean, premium: kam borders, halka surface tint, ek accent colour, consistent radius/spacing tokens, bahut spacing, empty states ek muted line.

TESTS
- Unit: pinnedOrder logic (pin, unpin, delete project, reorder, persistence, unknown ids), filter predicates aur counts (sirf unpinned), sorting (pinned manual vs unpinned urgent-first), Sync all state (running, partial failure, paused), Recent selection (pinned included, max 6, ek per project).
- Component (jsdom/testing-library jo harness hai): sections sirf data hone par render hon, empty states, compact card "—" fallbacks, pin toggle.
- Playwright (agar harness hai): drag reorder + restart ke baad order wahi, keyboard reorder, filters, Sync all. Screenshots .omc/screenshots/ mein (header, Recent, Pinned 2 cards, Projects filtered).

RULES
- Koi data fabricate nahi. Existing store, dashboard-contract.ts types, code style follow karo. Naye/badle files mein lint errors zero.
- Expanded card ke andar, sidebar, chat, Settings, Slack sync layer mat chhedo.

FINAL REPORT (isi chat mein)
Spec item table (item | status | evidence | commit), Recent ke gayab hone ka root cause, commits, typecheck/test/build ka asli output, naye tests, behaviour changes, screenshots ke paths, aur jo mujhe manually check karna hai (drag by hand, restart ke baad order, Sync all asli Slack se).
```
