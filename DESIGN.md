---
name: SYSONE office UI
description: Warm "paper and ink" look with one orange accent. On mobile the surfaces are compact and friendly (layout rules inspired by Airbnb's design analysis — modest type weights, hairline borders, one soft shadow, rounded 8/14/full, touch targets ≥ 40px). No Airbnb branding or colors are used.
colors:
  ink: "#2b2d42"        # text, icons
  paper: "#fffaf3"      # surfaces
  paper-2: "#fff1de"    # hover / soft fill
  accent: "#ff8a5b"     # the single accent: primary CTA, Interact button, active state
  good: "#06d6a0"       # online, success
  bad: "#ef476f"        # errors, absent
  navy: "#1b2a8c"       # brand (logo)
  line-mobile: "rgba(43,45,66,.14)"   # hairline border on mobile
typography:
  family: "var(--font)"  # project font stack
  mobile:
    title: 17px / 600
    section: 13px / 600 (sentence case, no uppercase on mobile)
    body: 13–14px / 400
    button: 13–14.5px / 500–600
    caption: 11–12.5px / 400–600
    badge: 9.5–10px / 600
rounded: { sm: 8px, md: 10px, card: 14px, dialog: 16px, full: 9999px }
spacing: { xs: 4px, sm: 8px, md: 12px, base: 16px }
elevation:
  mobile: "0 0 0 1px rgba(0,0,0,.02), 0 2px 6px rgba(0,0,0,.05), 0 4px 10px rgba(0,0,0,.09)"   # the only shadow tier
  dialog: "0 10px 30px rgba(0,0,0,.18)"
---

# SYSONE office — design rules

## Desktop
The existing playful style stays: paper surfaces, ink outlines, orange accent, bold headings.

## Mobile (≤ 760px) — compact and friendly
- **One accent.** Orange is only for the primary action: "Vào văn phòng", the Interact button, and active states.
  Everything else is paper and ink.
- **Modest type.** Titles 17px/600, section headers 13px/600 in sentence case, body 13–14px. No 800–900 weights,
  no uppercase labels.
- **Hairlines, not outlines.** 1px `line-mobile` borders and the single soft shadow. No thick ink borders and no
  offset "sticker" shadows.
- **Shapes.** Cards 14px, buttons 10px, pills and icon buttons fully round.
- **Touch targets.**
  - Icon buttons 36–40px.
  - Primary CTA 44px.
  - Joystick 104px.
  - Interact button 62px; Jump and Desk buttons 46px.
- **Collapse first.** The panel, minimap and music bar start collapsed. The panel opens as a bottom sheet (55% of the
  screen) and closes when the user taps the scene.
- **Dialogs.**
  - Character picker: full screen, with a fixed header and footer and a scrolling body.
  - Other dialogs: fit the screen, 16px radius.
- **Motion.** Fades and short rises of 0.18–0.28s. Respect `prefers-reduced-motion`.

### In-game HUD on mobile — "glass" (learned from hangmu.online)
- Controls floating over the scene use dark glass:
  - background `rgba(18,20,30,.52)` with `backdrop-filter: blur(8px)`;
  - 1px border `rgba(255,246,236,.26)`;
  - text `#fff6ec`;
  - font Be Vietnam Pro 600 (self-hosted via @fontsource);
  - covers: chat, panel toggle, online pill, minimap button, hints, toasts, notices, the key prompt, Jump/Desk buttons.
- The header keeps light glass, because the original SYSONE logo is a raster and only works on a light background.
- Interact is a 70px round orange gradient button with a light ring.
- The joystick is a 120px dark-glass base with a 54px orange knob.
- Positions use `max(16px, env(safe-area-inset-*))`.
- Sheets and dialogs (panel, chat, timesheet, character picker) stay paper, for readability.

### Rendering quality
Defaults are high, including on phones:
- pixel ratio up to 2.5× on phones and 2× on desktop, with antialias on;
- the "low" tier caps at 1.5× with no antialias; it applies only on weak devices (save-data, ≤4 GB RAM, ≤2 cores, old GPU).
- An adaptive monitor lowers the ratio by 0.25 when FPS < 40 and raises it when FPS > 57.
- On portrait screens (aspect < 0.85) the follow camera uses FOV 66, sits 15% farther away and a little higher.

The compact layout query is `(max-width: 760px), (max-height: 500px) and (max-width: 1100px)`; the mobile rules are the last such blocks in `src/ui/style.css`.
