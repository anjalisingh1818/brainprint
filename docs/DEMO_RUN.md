# Demo run: a new brain, trained by talking, asked a question it was never trained on

Record the screen while doing these steps, in order. Everything below is what the app really produced, so the video matches the app.

## 1. Build the brain (Brain Library → New brain)
- Name: **Privacy-first developer**
- Description: *Software developer who runs open-source tools and distrusts apps that track people.*

## 2. Train it by talking (Talk mode), three messages
1. "I won't install anything that tracks me. If an app wants my location or contacts for no good reason, I uninstall it. I'd much rather run something open source that I can read myself."
2. "Free public Wi-Fi sounds nice, but I'd assume every connection is logged and sold. Unless there's clear encryption and a no-logs promise from an independent auditor, I'd avoid it and use my own data."
3. "Government projects worry me more than companies. Once data is collected for one purpose it gets reused for others. I'd want strict limits written into law before I trust it."

Show on screen: the beliefs it learns (each with the exact quote from the message), the style card ("cautious, principled", "plain, technical"), and the "what this brain cares about" bars (privacy +0.71).

## 3. Ask the panel something it was never trained on (Brain Panel)
Problem: **City Wi-Fi in parks, paid by browsing data**
> Our city wants to offer free public Wi-Fi in all parks. To pay for it, the plan is to collect anonymised browsing data from people who connect and sell it to advertisers. Is this a good idea, and what would make it acceptable to you?

Show on screen, as each brain answers:
- **Privacy-first developer** (opposed): "I won't install anything that tracks me… I'd only consider it if it had strong encryption, an independent no-logs audit, and the code was open source."
- **Busy freelancer** (positive): "Free Wi-Fi that just works is exactly what I need… I'm fine with my browsing data being sold."
- **Cautious investor** (skeptical): "…feels like a risky two-sided marketplace… I'd demand a pilot with concrete metrics."
- **Skeptical CFO** (skeptical): "…a black-box revenue stream… I'd need an exportable data dump to Excel."

Click "Beliefs it relied on" on the new brain's card: the beliefs shown are the ones it actually trained on.

## 4. Synthesis
- **Agree:** all brains want strong privacy guarantees and auditable handling of data, and concrete evidence before a decision.
- **Clash:** selling anonymised browsing data is acceptable only with quick sign-up (freelancer) versus only with open source, a no-logs audit and end-to-end encryption (developer).
- **Joint solution:** a free baseline Wi-Fi that collects no browsing data, plus an optional opt-in premium tier; open-source firmware; an independent no-logs audit; a one-park pilot reporting results in an exportable sheet.

## 5. Show the graph (optional, 5 seconds)
The brain page's "Brain as a graph" card: brain → beliefs → concepts, all in one Relate file (`graph/brainprint.rl`).

## Honest notes for the narration
- The new brain's accuracy is **not measured yet** (it has only talked, not been quizzed). Say so, or run Quiz mode and cross-validation first.
- The three example brains use scripted answers and are labelled as examples.
- TRIBE v2 is not part of this demo; the brain-activity module was retired and is kept in `legacy/`.
