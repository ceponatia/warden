# Warden Trajectory: Visual Design Dictionary

This document establishes the opinionated visual language used by the Warden Trajectory system to render project history. It explains the specific constraints and design choices given to the LLM agents (Microscope and Telescope) when generating Mermaid.js diagrams.

---

## 1. Directional Flow: `flowchart LR`
**Decision:** We mandate `LR` (Left-to-Right) instead of `TD` (Top-Down).
**Justification:** 
When rendering text-heavy nodes (which include titles and `<sub>` descriptions), `TD` graphs quickly become vertically elongated and narrow. `LR` graphs utilize the natural widescreen aspect ratio of GitHub PR comments and modern monitors, allowing parallel branches to stack vertically while the chronological timeline flows horizontally. It prevents "scrolling fatigue."

## 2. Shape Semantics
**Decision:** We utilize Mermaid's advanced bracket syntax to assign meaning to node shapes, breaking away from standard rectangles.
**Justification:** 
A graph of 20 identical rectangles requires the user to read every single word to understand the architecture. By mapping shapes to domains, a Lead Engineer can scan the graph and immediately identify the database layer vs. the API layer.

*   **Standard Logic (`id[Text]`)**: Used for generic tasks, refactors, and utility functions.
*   **Infrastructure/Backend (`id[[Text]]`)**: The double-lined "Subroutine" box implies heavy, foundational backend systems (e.g., CI pipelines, core engines).
*   **Databases/Storage (`id[(Text)]`)**: The "Cylinder" shape universally signifies state and persistence.
*   **External Integrations (`id(/Text/)`)**: The "Parallelogram" shape implies I/O, representing boundaries where the system talks to the outside world (e.g., GitHub API, LLM Providers).
*   **Decisions/Pivots (`id{{Text}}`)**: The "Hexagon" represents a fork in the road. It highlights moments in the project's history where a significant architectural choice was made.
*   **Milestones (`id([Text])`)**: The "Stadium" shape (pill) acts as a clear bookend for Epics or Major Releases.

## 3. Font Awesome Iconography
**Decision:** Agents are instructed to aggressively utilize `fa:fa-` icons within node titles.
**Justification:** 
Icons act as visual "anchors" that decrease cognitive load. An icon of a bug (`fa:fa-bug`) or a lock (`fa:fa-lock`) conveys the intent of a node in 10 milliseconds. It increases the visual density of the graph, making it look like a polished dashboard rather than a raw diagram.

## 4. Anthropic-Inspired Color Palette (`classDef`)
**Decision:** We enforce a clean, warm, and highly legible color palette inspired by modern AI interfaces like Anthropic's Claude, stepping away from harsh corporate defaults or overwhelming neon cyberpunk themes.
**Justification:** 
The Warden system should feel elevated, calm, and readable in both light and dark modes on GitHub. We use soft off-whites, warm ambers, and muted slates to create a professional, colorful, but restrained visual aesthetic.

### Core Palette Definitions
*   `classDef core`: `fill:#f5f3ec, stroke:#d97757, stroke-width:2px, color:#1c1917` (Warm cream with Anthropic amber border - active/core work).
*   `classDef complete`: `fill:#f4f4f5, stroke:#a1a1aa, stroke-width:1px, color:#52525b` (Muted zinc - finished work).
*   `classDef goal`: `fill:#ecfdf5, stroke:#14b8a6, stroke-width:2px, color:#0f766e` (Soft teal - open objectives).
*   `classDef blocked`: `fill:#fff1f2, stroke:#f43f5e, stroke-width:2px, color:#9f1239` (Soft rose - dead ends or blockers).

*(Note: For strict Dark Mode environments, these translate to deep charcoal fills with the same vibrant stroke colors).*

## 5. Edge Semantics & Labeling
**Decision:** We utilize multiple edge types (`-->`, `-.->`, `==>`) and encourage edge labels.
**Justification:** 
In an execution graph, an arrow just means "blocks." In a *historical* graph, the relationship between two pieces of work is nuanced.
*   `-->` (Solid): Strict dependency. Feature A had to exist for Feature B to be built.
*   `-.->` (Dotted): Conceptual relationship. "We built the API, and then later we happened to build the UI."
*   `==>` (Thick): Invalidation/Superseding. "We built V1, but it failed, so it was completely replaced by V2."
*   **Labels (`-->|Migrated|`)**: Adding short text to edges explains the *transition* between states, which is often where the most critical architectural context lives.

## 6. The "Recent" Spotlight
**Decision:** The specific node representing the current Pull Request MUST be wrapped in a dashed subgraph `subgraph recent [🎯 CURRENT PR IMPACT]`.
**Justification:** 
When an agent drops a 15-node graph into a PR comment, the human reviewer's first question is, "Where am I in this map?" The `RECENT` subgraph acts as a giant "You Are Here" pin on a mall directory, instantly grounding the reviewer's perspective before they begin analyzing the surrounding neighborhood.

## 7. The Mermaid Visual Library (Agent Context)
To assist LLM agents in generating these graphs without hallucinating styles, they are provided with a strict **Visual Library** in their prompt context:

```mermaid
%% AGENT VISUAL LIBRARY REFERENCE
classDef core fill:#f5f3ec,stroke:#d97757,stroke-width:2px,color:#1c1917
classDef complete fill:#f4f4f5,stroke:#a1a1aa,stroke-width:1px,color:#52525b
classDef goal fill:#ecfdf5,stroke:#14b8a6,stroke-width:2px,color:#0f766e
classDef blocked fill:#fff1f2,stroke:#f43f5e,stroke-width:2px,color:#9f1239
```