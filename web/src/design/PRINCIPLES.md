# Vaelo design principles

Vaelo's interface is its body and face, not a wrapper around a text box. When
a decision is unclear, check it against these.

1. **Presence over decoration.** The Halo is Vaelo's face. Every agent state
   (idle, listening, waking, thinking, working, speaking, settling, concern)
   maps to one Halo state. Nothing else animates for its own sake.
2. **Calm tempo.** 180–600ms, `--ease`, no bounce, no spin, no flash. Ambient
   breathing is 6s. Reduced motion removes movement and keeps meaning.
3. **Honest, reassuring states.** Say what Vaelo is doing in plain words.
   Errors never alarm: earth tone (`--clay`), a kind sentence, one action.
4. **Warm restraint.** Tonal layers and hairlines over shadows. Brass is
   reserved for Vaelo's presence and the one primary action. The user's side
   stays neutral.
5. **Quiet luxury type.** Newsreader is Vaelo's voice (titles, quotes,
   greeting). Manrope is the interface. Nunito, rounded, is for small labels.
   Nothing under 12.5px; messages at 17px / 1.7.
6. **Desktop is deliberate, mobile is its own design.** Rail, conversation,
   dock on desktop. Drawer, bottom-anchored composer and 44px targets on
   mobile.
7. **Every control earns its place.** One icon set (Phosphor, light weight),
   one radius scale, one spacing scale, one elevation scale. No emoji.

## Tokens

All values live in `tokens.css`. Components read variables; they do not
introduce colors, radii or durations of their own.

## Voice

Short, warm, practical. "Good evening, Sarah." "What would you like to take
care of?" Never marketing copy.
