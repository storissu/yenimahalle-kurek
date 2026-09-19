# Accessibility

Goal: everyone in the club can use the app, including with a screen reader, large text, one hand, or a keyboard.
The target is WCAG 2.1 level AA.

## What is checked automatically (every CI run)

- **axe-core** scans about 45 screens (login, both Homes, RSVP open/locked, training pages, program editor, crew picker,
  attendance sheet, statistics, inbox, settings, boats, member directory, change history, dialogs) in **light and dark**.
  Serious/critical violations fail the build (`web/e2e/smoke.mjs`, `a11y()`), lesser ones are listed in the log.
- **Colour contrast**: every text/background token pair, both themes, ≥ 4.5:1, including the boat colours (`web/src/theme.contrast.test.ts`).
- **Keyboard**: skip link, page-change focus, arrow-key radio groups have unit tests and browser checks.
- Status is never colour alone (icons + words; boats always show their name next to their colour).

## What the app does for assistive technology

- `lang="tr"`, one `<h1>` per page, landmarks (`main`, `nav`), a **skip link** as the first tab stop.
- After every page change focus moves to the new heading and the tab title follows it — screen readers announce the page.
- Forms: labels, hints and errors are wired with `aria-describedby`/`aria-invalid`; errors are announced (`role="alert"`).
- Toasts are a polite live region; the offline banner is a status.
- Radio-style choices (RSVP, Geldi/Gelmedi, deadline presets) follow the ARIA arrow-key pattern; only one tab stop per group.
- Dialogs use the native `<dialog>` (focus trap, Escape, focus return); touch targets are ≥ 44 px (inline name links excepted, per WCAG 2.5.8).
- Animations are disabled when the phone asks for reduced motion; text scales with the phone's font size (rem units).

## Manual check before the pilot (15 minutes — automated tools catch about half of the problems)

Do it on a real phone, as a **member** and as a **coach**.

**iPhone — VoiceOver** (Settings → Accessibility → VoiceOver, or triple-click the side button)
1. Open the app from the Home Screen. Swipe right through Home: is it clear what is "Sizin programınız", the program by boat, and the RSVP card?
2. RSVP: can you choose *Katılıyorum* (double-tap), and does it say the answer was saved? After the program is published, does the card say the answer is locked?
3. In the program, double-tap a crew member's name: does the phone-number card open and can you call?
4. Go to another tab: does VoiceOver announce the new page title?

**Android — TalkBack** (Settings → Accessibility → TalkBack): repeat 1–4. Coach extras: open the program editor, add a session, assign a crew (the picker), try to publish a C4X with 3 people (the warning must be read out), record attendance (Geldi/Gelmedi).

**Text size and zoom**: phone settings → largest text; open Home, RSVP, the program editor, the attendance sheet. Nothing may be cut off or need sideways scrolling.

**Keyboard** (desktop browser): Tab through Login → Home. The skip link appears first; every control shows a focus ring; the arrow keys move inside the RSVP choices; Escape closes dialogs.

Write down what you find; small fixes are quick.

## Known gaps

- Real screen-reader behaviour differs between iOS and Android and cannot be tested from a developer machine (the checklist above).
- Charts: none. Maps: none. Video/audio: none.
- Members' names in the program are read as links/buttons ("… telefon numarasını göster"); if that is too chatty for screen-reader users the label can be shortened.
